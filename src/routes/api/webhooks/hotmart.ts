import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeHotmartPayload, verifyOne, extractHottokFromPayload } from "@/lib/hotmart/normalize";
import { buildIdempotencyKey } from "@/lib/hotmart/idempotency-key";
import { validateHotmartConfig } from "@/lib/hotmart.server";
import { clientIpFrom, hashIp } from "@/lib/rate-limit.server";
import { RETRYABLE_LEDGER_STATUSES, log, processEvent } from "@/lib/hotmart/process-event.server";

// Hotmart webhook — POST /api/webhooks/hotmart.
//
// Unlike src/routes/api/billing/webhook.ts (Lemon Squeezy), this route
// DOES hold SUPABASE_SERVICE_ROLE_KEY. That's a deliberate, narrow
// deviation from the LS webhook's "no service role key" posture — see
// docs/hotmart-integration-report.md §G: inviting a brand-new buyer
// (Supabase Auth admin.inviteUserByEmail) has no anon-safe path, and the
// existing internal reconcile-credits endpoint
// (src/routes/api/internal/reconcile-credits.ts) already establishes
// precedent for a Worker route holding this key when an admin-level
// action is genuinely unavoidable. The actual plan/credit MUTATIONS still
// go exclusively through process_hotmart_event (anon + BILLING_RPC_SECRET,
// same gate as Lemon Squeezy's RPC) — service_role here is used only to
// look up/invite a user and read hotmart_events/subscriptions, never to
// bypass the RPC's own validation.
//
// REBUILT 2026-07-19 (Fase 8C) after a confirmed live incident: the
// normalizer this route relied on was built against the wrong (flat/
// 1.0.0) payload shape, causing every real (nested/2.0.0) event to
// collapse to event_type="unrecognized_shape" and, worse, to share a
// single idempotency key — meaning only the very first of many distinct
// real events (approved, refunded, chargeback, ...) ever got a ledger
// row, and every later one falsely read back as "already_processed"
// without ever being examined. See normalize.ts and idempotency-key.ts
// for the corrected extraction/key logic, and
// docs/hotmart-integration-report.md §24-26 for the full incident
// writeup. This route now also: verifies Hottok via the header as well
// as the body field; isolates Hotmart's own test/sandbox payloads to
// zero commercial effect instead of silently letting them through
// whatever the (previously broken) classifier happened to produce; and
// returns a distinct, explicit `result` in every response body so a 200
// is never ambiguous evidence of a successful commercial mutation.

const MAX_BODY_BYTES = 100_000; // generous for a JSON webhook payload, small enough to reject abuse

// RETRYABLE_LEDGER_STATUSES, markRow, and processEvent now live in
// process-event.server.ts, shared with the internal reconciler task
// (tasks/reconcile-hotmart.ts) — see that module's header comment.

function json(body: { ok: boolean; result: string; message: string }, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST" },
  });
}

async function handlePost({ request }: { request: Request }) {
  const startedAt = Date.now();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  const hottokSecret = process.env.HOTMART_HOTTOK;
  const billingRpcSecret = process.env.BILLING_RPC_SECRET;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY || !hottokSecret || !billingRpcSecret) {
    log({ result: "rejected_config", latency_ms: Date.now() - startedAt });
    return json({ ok: false, result: "failed", message: "Hotmart webhook not configured" }, 501);
  }

  const configCheck = validateHotmartConfig();
  if (!configCheck.ok) {
    // Deliberately distinct from the secret-config check above: this means
    // the webhook CAN authenticate Hotmart, but has no mapped
    // product/offer to grant anything for yet. Never processes an event
    // in this state.
    log({ result: "rejected_config", reason: "offer_map_incomplete", missing: configCheck.missing, latency_ms: Date.now() - startedAt });
    return json({ ok: false, result: "failed", message: "Hotmart product/offer mapping not configured" }, 501);
  }

  // Content-Type validation before touching the body.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    log({ result: "rejected_content_type", latency_ms: Date.now() - startedAt });
    return json({ ok: false, result: "invalid_payload", message: "Unsupported Content-Type" }, 400);
  }

  // Body size cap, enforced by reading at most MAX_BODY_BYTES + 1 bytes —
  // never buffers an arbitrarily large body into memory first.
  const bodyReader = request.body?.getReader();
  let rawBody = "";
  if (bodyReader) {
    const decoder = new TextDecoder();
    let totalBytes = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await bodyReader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await bodyReader.cancel().catch(() => {});
        log({ result: "rejected_body_too_large", latency_ms: Date.now() - startedAt });
        return json({ ok: false, result: "invalid_payload", message: "Payload too large" }, 413);
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  }

  const supabaseAdmin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  // Security order (Fase C hotfix, 2026-07-19 — see
  // docs/hotmart-integration-report.md §30): method (enforced by the
  // route table itself — only POST ever reaches this function) -> Hottok
  // presence/validity -> JSON/structure -> rate limiting -> normalization
  // /idempotency -> commercial processing. This used to call the
  // rate-limiter RPC BEFORE authenticating the caller at all, which meant
  // an unrelated failure in that RPC (e.g. a misconfigured
  // BILLING_RPC_SECRET) turned into a 500 on every single request,
  // authenticated or not, before Hottok was ever checked — confirmed live
  // in production. Authenticating first, via the header alone whenever
  // possible, means a request that was never going to be accepted spends
  // no DB round-trip at all.
  const headerHottok = request.headers.get("x-hotmart-hottok");
  let payload: unknown;
  let authenticated = verifyOne(headerHottok, hottokSecret);

  if (!authenticated) {
    // No valid header — the only remaining way to authenticate is the
    // body's own `hottok` field, which requires parsing JSON first. A
    // parse failure here is intentionally still reported as 401, not
    // 400: we do not yet know whether this caller is legitimate, and
    // "invalid JSON" is only ever a meaningful, safe-to-disclose signal
    // for an ALREADY authenticated caller (see below).
    try {
      payload = JSON.parse(rawBody);
    } catch {
      log({ result: "rejected_auth", reason: "no_valid_header_and_unparseable_body", latency_ms: Date.now() - startedAt });
      return json({ ok: false, result: "failed", message: "Unauthorized" }, 401);
    }
    authenticated = verifyOne(extractHottokFromPayload(payload), hottokSecret);
    if (!authenticated) {
      log({ result: "rejected_auth", latency_ms: Date.now() - startedAt });
      return json({ ok: false, result: "failed", message: "Unauthorized" }, 401);
    }
  }

  // Authenticated. If we authenticated via the header alone, the body
  // still hasn't been parsed — do that now, with its own honest 400.
  if (payload === undefined) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      log({ result: "rejected_invalid_json", latency_ms: Date.now() - startedAt });
      return json({ ok: false, result: "invalid_payload", message: "Invalid JSON" }, 400);
    }
  }

  const event = normalizeHotmartPayload(payload);
  if (event.parseWarnings.length > 0) {
    log({ scope: "hotmart_webhook_parse_warnings", event_type: event.eventType, raw_event_name: event.rawEventName, warnings: event.parseWarnings });
  }

  // Rate limit — only ever reached by an already-authenticated caller.
  // Keyed by hashed source IP, gated by BILLING_RPC_SECRET (see
  // claim_webhook_rate_limit's own comment for why: there is no
  // auth.uid() on an inbound webhook call to authenticate the caller
  // otherwise). A failure HERE (RPC unreachable, misconfigured secret,
  // etc.) is this endpoint's own infrastructure being unavailable, not
  // the caller's fault — 503, never a generic 500, so Hotmart's retry
  // logic knows to try again rather than treating it as a permanent
  // rejection. Rate limiting itself is never skipped or bypassed on this
  // failure path — a broken limiter fails CLOSED (503), not open.
  const ipHash = await hashIp(clientIpFrom(request));
  const rateKey = ipHash ?? "no-ip";
  const { data: rateLimitRows, error: rateLimitError } = await supabaseAdmin.rpc("claim_webhook_rate_limit", {
    p_secret: billingRpcSecret,
    p_rate_key: `hotmart:${rateKey}`,
    p_window_seconds: 60,
    p_max_requests: 60,
  });
  if (rateLimitError) {
    log({ result: "error", reason: "rate_limit_unavailable", latency_ms: Date.now() - startedAt });
    return json({ ok: false, result: "failed", message: "Temporarily unavailable" }, 503, { "Retry-After": "30" });
  }
  const rateLimit = rateLimitRows?.[0];
  if (!rateLimit?.allowed) {
    log({ result: "rate_limited", latency_ms: Date.now() - startedAt });
    return json({ ok: false, result: "failed", message: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  const idempotencyKey = buildIdempotencyKey(event);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");

  // Register the event FIRST, before any processing — the UNIQUE
  // constraint on idempotency_key is what makes a redelivered event a
  // guaranteed no-op even if two deliveries race concurrently.
  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from("hotmart_events")
    .insert({
      idempotency_key: idempotencyKey,
      external_event_id: event.externalEventId,
      event_type: event.eventType,
      transaction_id: event.transactionId,
      subscription_id: event.subscriptionId,
      product_id: event.productId,
      offer_id: event.offerId,
      buyer_email: event.buyerEmail,
      payload_hash: payloadHash,
      processing_status: "pending",
    })
    .select("id")
    .single();

  let hotmartEventRowId: string;

  if (insertError) {
    if (insertError.code !== "23505") {
      log({ result: "error", reason: "ledger_insert_failed", latency_ms: Date.now() - startedAt });
      return json({ ok: false, result: "failed", message: "Webhook handling failed" }, 500);
    }

    // Conflict on idempotency_key — either a genuine duplicate delivery of
    // an event we've already resolved, or a legitimate retry of a
    // delivery that previously failed before reaching a final state (see
    // RETRYABLE_LEDGER_STATUSES above).
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("hotmart_events")
      .select("id, processing_status")
      .eq("idempotency_key", idempotencyKey)
      .single();

    if (existingError || !existing) {
      log({ result: "error", reason: "ledger_conflict_lookup_failed", latency_ms: Date.now() - startedAt });
      return json({ ok: false, result: "failed", message: "Webhook handling failed" }, 500);
    }

    if (!RETRYABLE_LEDGER_STATUSES.has(existing.processing_status)) {
      log({ result: "duplicate", event_type: event.eventType, prior_status: existing.processing_status, latency_ms: Date.now() - startedAt });
      return json(
        { ok: true, result: "duplicate", message: `already resolved as ${existing.processing_status}` },
        200,
      );
    }

    const { error: resetError } = await supabaseAdmin
      .from("hotmart_events")
      .update({ processing_status: "pending", last_error: null })
      .eq("id", existing.id);
    if (resetError) {
      log({ result: "error", reason: "ledger_retry_reset_failed", latency_ms: Date.now() - startedAt });
      return json({ ok: false, result: "failed", message: "Webhook handling failed" }, 500);
    }
    hotmartEventRowId = existing.id;
    log({ result: "retrying", event_type: event.eventType, prior_status: existing.processing_status, latency_ms: Date.now() - startedAt });
  } else {
    hotmartEventRowId = insertedRows.id;
  }

  const outcome = await processEvent({
    supabaseAdmin,
    event,
    hotmartEventRowId,
    billingRpcSecret,
  });

  log({ result: outcome.result, event_type: event.eventType, latency_ms: Date.now() - startedAt });
  return json({ ok: outcome.httpStatus < 400, result: outcome.result, message: outcome.message }, outcome.httpStatus);
}

export const Route = createFileRoute("/api/webhooks/hotmart")({
  server: {
    handlers: {
      POST: handlePost,
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});
