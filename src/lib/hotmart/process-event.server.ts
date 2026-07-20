import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isPlausibleCurrencyCode, type HotmartNormalizedEvent } from "@/lib/hotmart/normalize";
import { buildIdempotencyKey } from "@/lib/hotmart/idempotency-key";
import { findMappingByIds } from "@/lib/hotmart.server";
import { resolveOrInviteBuyer, recordPendingLink } from "@/lib/hotmart/buyer-linking.server";

// Shared commercial-processing core for a single, already-authenticated
// Hotmart event. Extracted out of the public webhook route
// (routes/api/webhooks/hotmart.ts) so the SAME tested logic can also be
// replayed by the internal reconciler (tasks/reconcile-hotmart.ts) for a
// ledger row that failed on a since-fixed transient cause (e.g. the old
// currency hard-block) — without duplicating the mapping/buyer-linking/RPC
// logic in two places and without either caller re-checking Hottok: by the
// time a HotmartNormalizedEvent reaches processEvent, authentication has
// already happened (either by the public route's own header/body Hottok
// check, or implicitly by the fact the row already exists in hotmart_events,
// which only ever gets written after that same check passes).

// Ledger rows in these processing_status values represent a delivery that
// never reached a final, correct classification — a redelivery of the SAME
// idempotency key while the row is in one of these states is treated as a
// legitimate retry (the row is reset to 'pending' and reprocessed) rather
// than swallowed as "duplicate". Deliberately does NOT include 'pending'
// itself: a row currently 'pending' almost always means another request for
// the exact same key is being processed right now (a true concurrent
// redelivery), and letting a second request pile on top of that would risk
// double-processing (double invite email, double billing_history row,
// etc.). A row genuinely stuck at 'pending' forever (Worker crashed
// mid-request) is swept to 'error' by reconcile_hotmart_stale — after which
// it lands in neither this list nor the terminal set below, and is
// intentionally left for admin review rather than auto-retried.
export const RETRYABLE_LEDGER_STATUSES = new Set(["failed", "pending_link"]);

export type HandlerResult = { httpStatus: number; result: string; message: string };

export function log(fields: Record<string, unknown>) {
  // Structured, secret-free observability — never the raw payload, never a
  // hottok/secret value, never a stack trace.
  console.log(JSON.stringify({ scope: "hotmart_webhook", ...fields }));
}

export async function markRow(
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

export async function processEvent(args: {
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
  // isLikelyTestPayload) — recorded for audit, isolated to zero commercial
  // effect, REGARDLESS of what the event otherwise classified as. This
  // check runs before any mapping/buyer/RPC logic on purpose.
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

  // Currency/amount: hard-blocked only when structurally impossible, never
  // merely "different from the offer's reference currency". See
  // docs/hotmart-integration-report.md §5 for the incident that drove this:
  // a real POSTULPRO30 purchase was legitimately charged in ARS (Hotmart's
  // own IP-based localization for international buyers) and was wrongly
  // rejected by an equality check against USD — even though `expectedPrice`
  // was never actually validated either, so the currency check added no
  // real protection against a mispriced purchase. The offer_id match above
  // is, and remains, the sole authority for which plan/credits this event
  // grants; currency/amount are recorded for audit and anomaly review,
  // never used to gate a legitimately mapped offer.
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
  // resolve the buyer by email (existing account or invite a new one — see
  // buyer-linking.server.ts). For every subsequent event, use the ALREADY-
  // linked subscription's own user_id — never re-derived from the payload's
  // email, exactly like process_lemon_squeezy_event's non-initial branches.
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

  // Hotmart's real payload has no explicit "this is a renewal" flag distinct
  // from a fresh purchase — both arrive as event="PURCHASE_APPROVED". The
  // only reliable signal is our own state: a subscriptions row already
  // existing for this subscriber_code before this event means it's a
  // renewal, not an initial purchase. This matters beyond bookkeeping — it's
  // also what makes replaying a SECOND ledger row for the same purchase
  // (e.g. Hotmart's "Compra aprobada" and "Compra completa" both landing as
  // separate rows) safe to reconcile: the second replay resolves to
  // 'renewal_approved' against the subscription the first replay just
  // created, which process_hotmart_event applies with SET semantics (never
  // increments credits), and never re-sends the purchase_approved welcome
  // email.
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
      // Buyer resolution failed (e.g. Supabase Auth unreachable) — record a
      // pending link for admin resolution rather than losing the event, and
      // mark the ledger row retryable (see RETRYABLE_LEDGER_STATUSES) rather
      // than a terminal state, since this class of failure may well be
      // transient.
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
