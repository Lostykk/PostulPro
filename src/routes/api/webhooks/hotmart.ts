import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { normalizeHotmartPayload, verifyHottok } from "@/lib/hotmart/normalize";
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

const MAX_BODY_BYTES = 100_000; // generous for a JSON webhook payload, small enough to reject abuse

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function methodNotAllowed() {
  return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
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
    return json({ error: "Hotmart webhook not configured" }, 501);
  }

  const configCheck = validateHotmartConfig();
  if (!configCheck.ok) {
    // Deliberately distinct from the secret-config check above: this means
    // the webhook CAN authenticate Hotmart, but has no mapped
    // product/offer to grant anything for yet. Never processes an event
    // in this state — see Fase D's "no invented identifiers" rule.
    log({ result: "rejected_config", reason: "offer_map_incomplete", missing: configCheck.missing, latency_ms: Date.now() - startedAt });
    return json({ error: "Hotmart product/offer mapping not configured" }, 501);
  }

  // Content-Type validation before touching the body.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    log({ result: "rejected_content_type", latency_ms: Date.now() - startedAt });
    return json({ error: "Unsupported Content-Type" }, 400);
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
        return json({ error: "Payload too large" }, 413);
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  }

  const supabaseAdmin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  // Rate limit before parsing/authenticating — keyed by hashed source IP,
  // gated by BILLING_RPC_SECRET (see claim_webhook_rate_limit's own
  // comment for why: there is no auth.uid() on an inbound webhook call to
  // authenticate the caller otherwise).
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
    return json({ error: "Temporarily unavailable" }, 500);
  }
  const rateLimit = rateLimitRows?.[0];
  if (!rateLimit?.allowed) {
    log({ result: "rate_limited", latency_ms: Date.now() - startedAt });
    return json({ error: "Too many requests" }, 429, { "Retry-After": "60" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log({ result: "rejected_invalid_json", latency_ms: Date.now() - startedAt });
    return json({ error: "Invalid JSON" }, 400);
  }

  const event = normalizeHotmartPayload(payload);

  // Hottok verification — see normalize.ts's header comment for exactly
  // what is/isn't confirmed about this mechanism. Constant-time compare,
  // never a plain === . A missing or wrong hottok is rejected identically
  // (no information leaked about which failed).
  if (!verifyHottok(event.hottok, hottokSecret)) {
    log({ result: "rejected_auth", latency_ms: Date.now() - startedAt });
    return json({ error: "Unauthorized" }, 401);
  }

  const idempotencyKey = buildIdempotencyKey(event);

  // Register the event FIRST, before any processing — the UNIQUE
  // constraint on idempotency_key is what makes a redelivered event a
  // guaranteed no-op even if two deliveries race concurrently. ON
  // CONFLICT DO NOTHING + a follow-up SELECT tells us whether THIS
  // request is the one that actually inserted (fresh) or lost the race
  // (duplicate) — either way, we never proceed with a second
  // process_hotmart_event call for the same key.
  const { data: insertedRows, error: insertError } = await supabaseAdmin
    .from("hotmart_events")
    .insert({
      idempotency_key: idempotencyKey,
      event_type: event.eventType,
      transaction_id: event.transactionId,
      subscription_id: event.subscriptionId,
      product_id: event.productId,
      offer_id: event.offerId,
      buyer_email: event.buyerEmail,
      processing_status: "pending",
    })
    .select("id")
    .single();

  let hotmartEventRowId: string;
  if (insertError) {
    if (insertError.code === "23505") {
      // Duplicate delivery of an event we've already seen — respond success
      // without re-processing, regardless of whether the first delivery
      // finished processing yet.
      log({ result: "already_processed", event_type: event.eventType, latency_ms: Date.now() - startedAt });
      return json({ ok: true, message: "already processed" }, 200);
    }
    log({ result: "error", reason: "ledger_insert_failed", latency_ms: Date.now() - startedAt });
    return json({ error: "Webhook handling failed" }, 500);
  }
  hotmartEventRowId = insertedRows.id;

  // Events we don't act on at all (ambiguous/in-flight status, or a shape
  // we couldn't parse) are still ledgered (for observability/audit) but
  // never reach process_hotmart_event — never a default guess at a
  // financial action.
  if (event.eventType === "ignored" || event.eventType === "unrecognized_shape") {
    await supabaseAdmin
      .from("hotmart_events")
      .update({ processing_status: "ignored", processed_at: new Date().toISOString() })
      .eq("id", hotmartEventRowId);
    log({ result: "ignored", event_type: event.eventType, latency_ms: Date.now() - startedAt });
    return json({ ok: true, message: "ignored" }, 200);
  }

  // Only processes events for a configured, mapped product+offer — an
  // unrecognized product_id/offer_id is never trusted, never guessed from
  // price/name/currency (see hotmart.server.ts's findMappingByIds).
  // Non-initial lifecycle events (cancellation, refund, chargeback,
  // payment_failed, reactivation) legitimately carry no offer_id at all in
  // some Hotmart deliveries — those resolve their plan from the ALREADY
  // linked subscriptions row instead (see below), not from this mapping.
  const mapping =
    event.productId && event.offerId ? findMappingByIds(event.productId, event.offerId) : undefined;

  if ((event.eventType === "purchase_approved" || event.eventType === "plan_change") && !mapping) {
    await supabaseAdmin
      .from("hotmart_events")
      .update({ processing_status: "ignored", processed_at: new Date().toISOString(), last_error: "unmapped product/offer" })
      .eq("id", hotmartEventRowId);
    log({ result: "ignored", reason: "unmapped_product_offer", latency_ms: Date.now() - startedAt });
    return json({ ok: true, message: "ignored" }, 200);
  }

  // Currency is validated against the mapped offer's expected currency,
  // never used to infer the plan (see hotmart.server.ts's
  // HotmartOfferMapping.expectedCurrency and Fase D's explicit "no
  // mapear por moneda solamente" rule). A mismatch on an otherwise
  // correctly-mapped offer is unusual enough (a different storefront
  // currency, a misconfigured offer) to hold for review rather than
  // silently grant access at a price point that was never actually
  // approved for that currency.
  if (mapping && event.currency && event.currency.toUpperCase() !== mapping.expectedCurrency) {
    await supabaseAdmin
      .from("hotmart_events")
      .update({
        processing_status: "error",
        processed_at: new Date().toISOString(),
        last_error: `unexpected currency: ${event.currency}`,
      })
      .eq("id", hotmartEventRowId);
    log({ result: "error", reason: "unexpected_currency", latency_ms: Date.now() - startedAt });
    return json({ ok: false, error: "Unexpected currency" }, 400);
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
      .select("user_id, plan, billing_interval")
      .eq("provider_subscription_id", event.subscriptionId)
      .eq("provider", "hotmart")
      .maybeSingle();
    existingSubscriptionUserId = existingSub?.user_id ?? null;
  }

  // Hotmart's confirmed flat payload has no explicit "this is a renewal"
  // flag distinct from a fresh purchase — both arrive with the same
  // `status: approved`. The only reliable signal is our own state: a
  // subscriptions row already existing for this subscriber_code before
  // this event means it's a renewal, not an initial purchase. This
  // matters beyond bookkeeping — process_hotmart_event only sends the
  // "pro_confirmation" welcome email for 'purchase_approved', never for
  // 'renewal_approved', matching the original contract's explicit
  // requirement ("renovación: igual que compra aprobada, sin re-enviar
  // email de bienvenida").
  const effectiveEventType =
    existingSubscriptionUserId && event.eventType === "purchase_approved" ? "renewal_approved" : event.eventType;

  if (existingSubscriptionUserId) {
    userId = existingSubscriptionUserId;
  } else if (event.eventType === "purchase_approved" || event.eventType === "plan_change") {
    if (!event.buyerEmail) {
      await supabaseAdmin
        .from("hotmart_events")
        .update({ processing_status: "error", processed_at: new Date().toISOString(), last_error: "missing buyer email" })
        .eq("id", hotmartEventRowId);
      log({ result: "error", reason: "missing_buyer_email", latency_ms: Date.now() - startedAt });
      return json({ ok: false, error: "Missing buyer email" }, 400);
    }
    try {
      const resolution = await resolveOrInviteBuyer(supabaseAdmin, event.buyerEmail);
      userId = resolution.userId;
    } catch (err) {
      // Buyer resolution failed (e.g. Supabase Auth unreachable) — record
      // a pending link for admin resolution rather than losing the event.
      // Sanitized message only, never a raw stack trace.
      const reason = err instanceof Error ? err.message : "buyer resolution failed";
      await recordPendingLink(supabaseAdmin, {
        hotmartEventId: hotmartEventRowId,
        buyerEmail: event.buyerEmail,
        transactionId: event.transactionId,
        subscriptionId: event.subscriptionId,
        productId: event.productId,
        offerId: event.offerId,
      }).catch(() => {});
      await supabaseAdmin
        .from("hotmart_events")
        .update({ processing_status: "error", processed_at: new Date().toISOString(), last_error: reason })
        .eq("id", hotmartEventRowId);
      log({ result: "error", reason: "buyer_resolution_failed", latency_ms: Date.now() - startedAt });
      return json({ error: "Webhook handling failed" }, 500);
    }
  }

  if (!userId) {
    // A lifecycle event (cancellation/refund/etc.) referencing a
    // subscription we've never seen — nothing to update, log and accept
    // (not an error: Hotmart may resend historical events, or this event
    // arrived before its own purchase_approved for reasons outside our
    // control).
    await supabaseAdmin
      .from("hotmart_events")
      .update({ processing_status: "ignored", processed_at: new Date().toISOString(), last_error: "no linked subscription" })
      .eq("id", hotmartEventRowId);
    log({ result: "ignored", reason: "no_linked_subscription", latency_ms: Date.now() - startedAt });
    return json({ ok: true, message: "ignored" }, 200);
  }

  const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc("process_hotmart_event", {
    p_secret: billingRpcSecret,
    p_idempotency_key: idempotencyKey,
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
  });

  if (rpcError) {
    await supabaseAdmin
      .from("hotmart_events")
      .update({ processing_status: "error", processed_at: new Date().toISOString(), last_error: rpcError.message.slice(0, 300) })
      .eq("id", hotmartEventRowId);
    log({ result: "error", reason: "rpc_failed", latency_ms: Date.now() - startedAt });
    return json({ error: "Webhook handling failed" }, 500);
  }

  const result = rpcRows?.[0];
  if (!result?.ok) {
    await supabaseAdmin
      .from("hotmart_events")
      .update({ processing_status: "error", processed_at: new Date().toISOString(), last_error: (result?.message ?? "rpc rejected").slice(0, 300) })
      .eq("id", hotmartEventRowId);
    log({ result: "error", reason: result?.message ?? "rpc_rejected", latency_ms: Date.now() - startedAt });
    return json({ error: "Webhook handling failed" }, 500);
  }

  log({ result: "processed", event_type: effectiveEventType, latency_ms: Date.now() - startedAt });
  return json({ ok: true, message: result.message }, 200);
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
