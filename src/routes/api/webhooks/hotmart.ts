import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeHotmartPayload, verifyOne, extractHottokFromPayload, isPlausibleCurrencyCode, type HotmartNormalizedEvent } from "@/lib/hotmart/normalize";
import { buildIdempotencyKey } from "@/lib/hotmart/idempotency-key";
import { findMappingByIds, validateHotmartConfig } from "@/lib/hotmart.server";
import { resolveOrInviteBuyer, recordPendingLink } from "@/lib/hotmart/buyer-linking.server";
import { clientIpFrom, hashIp } from "@/lib/rate-limit.server";

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

// Ledger rows in these processing_status values represent a delivery
// that never reached a final, correct classification — a redelivery of
// the SAME idempotency key while the row is in one of these states is
// treated as a legitimate retry (the row is reset to 'pending' and
// reprocessed) rather than swallowed as "duplicate". Deliberately does
// NOT include 'pending' itself: a row currently 'pending' almost always
// means another request for the exact same key is being processed right
// now (a true concurrent redelivery), and letting a second request pile
// on top of that would risk double-processing (double invite email,
// double billing_history row, etc.). A row genuinely stuck at 'pending'
// forever (Worker crashed mid-request) is swept to 'error' by
// reconcile_hotmart_stale — after which it lands in neither this list
// nor the terminal set below, and is intentionally left for admin
// review rather than auto-retried by a live webhook redelivery.
const RETRYABLE_LEDGER_STATUSES = new Set(["failed", "pending_link"]);

type HandlerResult = { httpStatus: number; result: string; message: string };

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

function log(fields: Record<string, unknown>) {
  // Structured, secret-free observability — never the raw payload, never
  // a hottok/secret value, never a stack trace. Matches the posture of
  // logWebhookEvent in the Lemon Squeezy webhook route.
  console.log(JSON.stringify({ scope: "hotmart_webhook", ...fields }));
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

async function markRow(
  supabaseAdmin: ReturnType<typeof createClient<Database>>,
  rowId: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  await supabaseAdmin
    .from("hotmart_events")
    .update({ processing_status: status, processed_at: new Date().toISOString(), ...extra })
    .eq("id", rowId);
}

async function processEvent(args: {
  supabaseAdmin: ReturnType<typeof createClient<Database>>;
  event: HotmartNormalizedEvent;
  hotmartEventRowId: string;
  billingRpcSecret: string;
}): Promise<HandlerResult> {
  const { supabaseAdmin, event, hotmartEventRowId, billingRpcSecret } = args;

  // Authenticated but structurally invalid — never a false 200.
  if (event.eventType === "invalid_payload") {
    await markRow(supabaseAdmin, hotmartEventRowId, "invalid_payload", { last_error: event.parseWarnings.join("; ").slice(0, 300) });
    return { httpStatus: 422, result: "invalid_payload", message: "Payload missing minimum expected structure" };
  }

  // Hotmart's own test/sandbox deliveries (see normalize.ts's
  // isLikelyTestPayload) — recorded for audit, isolated to zero
  // commercial effect, REGARDLESS of what the event otherwise classified
  // as. This check runs before any mapping/buyer/RPC logic on purpose.
  if (event.isTestPayload) {
    await markRow(supabaseAdmin, hotmartEventRowId, "ignored_test");
    return { httpStatus: 200, result: "ignored_test", message: "Recognized as a Hotmart test event — no commercial effect" };
  }

  if (event.eventType === "no_action_required") {
    await markRow(supabaseAdmin, hotmartEventRowId, "no_action_required");
    return { httpStatus: 200, result: "no_action_required", message: "Event understood, no action required" };
  }

  if (event.eventType === "unsupported") {
    await markRow(supabaseAdmin, hotmartEventRowId, "unsupported", { last_error: event.parseWarnings.join("; ").slice(0, 300) });
    return { httpStatus: 200, result: "unsupported", message: "Authenticated event with no known mapping — held for review" };
  }

  // Only processes events for a configured, mapped product+offer — an
  // unrecognized product_id/offer_id is never trusted, never guessed from
  // price/name/currency (see hotmart.server.ts's findMappingByIds).
  // Non-initial lifecycle events (cancellation, refund, chargeback,
  // payment_failed, reactivation) legitimately carry no offer_id at all in
  // some Hotmart deliveries — those resolve their plan from the ALREADY
  // linked subscriptions row instead (see below), not from this mapping.
  const mapping = event.productId && event.offerId ? findMappingByIds(event.productId, event.offerId) : undefined;

  if ((event.eventType === "purchase_approved" || event.eventType === "plan_change") && !mapping) {
    await markRow(supabaseAdmin, hotmartEventRowId, "unmapped_offer", { last_error: `product=${event.productId ?? "null"} offer=${event.offerId ?? "null"}` });
    return { httpStatus: 200, result: "unmapped_offer", message: "Product/offer not configured — held for review" };
  }

  // Currency/amount: hard-blocked only when structurally impossible,
  // never merely "different from the offer's reference currency". See
  // docs/hotmart-integration-report.md §5 for the incident that drove
  // this: a real POSTULPRO30 purchase was legitimately charged in ARS
  // (Hotmart's own IP-based localization for international buyers) and
  // was wrongly rejected by an equality check against USD — even though
  // `expectedPrice` was never actually validated either, so the currency
  // check added no real protection against a mispriced purchase. The
  // offer_id match above is, and remains, the sole authority for which
  // plan/credits this event grants; currency/amount are recorded for
  // audit and anomaly review, never used to gate a legitimately mapped
  // offer.
  if (mapping && event.currency && !isPlausibleCurrencyCode(event.currency)) {
    await markRow(supabaseAdmin, hotmartEventRowId, "failed", { last_error: `malformed currency value: ${event.currency.slice(0, 20)}` });
    return { httpStatus: 400, result: "failed", message: "Malformed currency value" };
  }
  if (mapping && event.fullPrice !== null && (!Number.isFinite(event.fullPrice) || event.fullPrice <= 0)) {
    await markRow(supabaseAdmin, hotmartEventRowId, "failed", { last_error: `structurally invalid amount: ${event.fullPrice}` });
    return { httpStatus: 400, result: "failed", message: "Structurally invalid amount" };
  }
  if (mapping && event.currency && event.currency.toUpperCase() !== mapping.expectedCurrency) {
    // Observability only — never blocks. Logged (not persisted to a new
    // column; see the report's scoping note on why this round didn't add
    // one) so currency conversions are visible without gating access.
    log({
      scope: "hotmart_webhook_currency_observation",
      event: "currency_conversion_detected",
      base_currency: mapping.expectedCurrency,
      charged_currency: event.currency.toUpperCase(),
      offer_id: event.offerId,
      transaction_id: event.transactionId,
    });
  }

  // Resolve user_id: for the very first event on a subscription (no
  // existing subscriptions row for this provider_subscription_id yet),
  // resolve the buyer by email (existing account or invite a new one —
  // see buyer-linking.server.ts). For every subsequent event, use the
  // ALREADY-linked subscription's own user_id — never re-derived from the
  // payload's email, exactly like process_lemon_squeezy_event's
  // non-initial branches.
  let userId: string | null = null;
  let existingSubscriptionUserId: string | null = null;
  if (event.subscriptionId) {
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id")
      .eq("provider_subscription_id", event.subscriptionId)
      .eq("provider", "hotmart")
      .maybeSingle();
    existingSubscriptionUserId = existingSub?.user_id ?? null;
  }

  // Hotmart's real payload has no explicit "this is a renewal" flag
  // distinct from a fresh purchase — both arrive as event="PURCHASE_APPROVED".
  // The only reliable signal is our own state: a subscriptions row already
  // existing for this subscriber_code before this event means it's a
  // renewal, not an initial purchase. This matters beyond bookkeeping —
  // process_hotmart_event only sends the "pro_confirmation" welcome email
  // for 'purchase_approved', never for 'renewal_approved'.
  const effectiveEventType: string =
    existingSubscriptionUserId && event.eventType === "purchase_approved" ? "renewal_approved" : event.eventType;

  if (existingSubscriptionUserId) {
    userId = existingSubscriptionUserId;
  } else if (event.eventType === "purchase_approved" || event.eventType === "plan_change") {
    if (!event.buyerEmail) {
      await markRow(supabaseAdmin, hotmartEventRowId, "invalid_payload", { last_error: "missing buyer email" });
      return { httpStatus: 400, result: "invalid_payload", message: "Missing buyer email" };
    }
    try {
      const resolution = await resolveOrInviteBuyer(supabaseAdmin, event.buyerEmail);
      userId = resolution.userId;
    } catch (err) {
      // Buyer resolution failed (e.g. Supabase Auth unreachable) — record
      // a pending link for admin resolution rather than losing the event,
      // and mark the ledger row retryable (see RETRYABLE_LEDGER_STATUSES)
      // rather than a terminal state, since this class of failure may
      // well be transient.
      const reason = err instanceof Error ? err.message : "buyer resolution failed";
      await recordPendingLink(supabaseAdmin, {
        hotmartEventId: hotmartEventRowId,
        buyerEmail: event.buyerEmail,
        transactionId: event.transactionId,
        subscriptionId: event.subscriptionId,
        productId: event.productId,
        offerId: event.offerId,
      }).catch(() => {});
      await markRow(supabaseAdmin, hotmartEventRowId, "pending_link", { last_error: reason.slice(0, 300) });
      return { httpStatus: 500, result: "pending_link", message: "Buyer resolution failed — parked for admin review, retry allowed" };
    }
  }

  if (!userId) {
    // A lifecycle event (cancellation/refund/etc.) referencing a
    // subscription we've never seen — nothing to update, log and accept
    // (not an error: Hotmart may resend historical events, or this event
    // arrived before its own purchase_approved for reasons outside our
    // control).
    await markRow(supabaseAdmin, hotmartEventRowId, "no_action_required", { last_error: "no linked subscription" });
    return { httpStatus: 200, result: "no_action_required", message: "No linked subscription for this event yet" };
  }

  const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc("process_hotmart_event", {
    p_secret: billingRpcSecret,
    p_idempotency_key: buildIdempotencyKey(event),
    p_event_type: effectiveEventType,
    p_user_id: userId,
    p_provider_subscription_id: event.subscriptionId ?? "",
    p_provider_customer_id: "",
    p_product_id: event.productId ?? "",
    p_offer_id: event.offerId ?? "",
    p_status: event.rawStatus ?? "",
    p_plan: mapping?.plan ?? "",
    p_billing_interval: mapping?.interval ?? "",
    p_credits_limit: mapping?.creditsLimit ?? 0,
    // Not yet confirmed in the real payload's captured structure (see
    // normalize.ts's header comment) — never guessed, always omitted.
    p_renews_at: undefined,
    p_ends_at: undefined,
    p_provider_updated_at: event.providerUpdatedAt ?? undefined,
  });

  if (rpcError) {
    await markRow(supabaseAdmin, hotmartEventRowId, "failed", { last_error: rpcError.message.slice(0, 300) });
    return { httpStatus: 500, result: "failed", message: "Webhook handling failed" };
  }

  const result = rpcRows?.[0];
  if (!result?.ok) {
    await markRow(supabaseAdmin, hotmartEventRowId, "failed", { last_error: (result?.message ?? "rpc rejected").slice(0, 300) });
    return { httpStatus: 500, result: "failed", message: "Webhook handling failed" };
  }

  await markRow(supabaseAdmin, hotmartEventRowId, "processed", { user_id: userId, action_taken: effectiveEventType });
  return { httpStatus: 200, result: "processed", message: result.message ?? "processed" };
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
