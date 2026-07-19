import { timingSafeEqual } from "node:crypto";

// Server-only. Normalizes Hotmart's webhook payload into the internal,
// provider-agnostic event vocabulary process_hotmart_event's p_event_type
// expects (see supabase/migrations/20260729010000_process_hotmart_event_rpc.sql).
//
// Confirmed-vs-assumed, per docs/hotmart-integration-report.md §B (Fase B
// research — official developers.hotmart.com content only, third-party
// "integration guide" claims explicitly discarded as unreliable):
//
// CONFIRMED (multiple corroborating official-domain search results):
//   - Flat/legacy ("1.0.0") payload field names: Prod, Off, Email, Doc,
//     Transaction, Status, Full_price, Currency, Subscriber_code,
//     Subscription_status, Hottok.
//   - Purchase `status` enum: approved, canceled, billet_printed,
//     refunded, dispute, completed, blocked, chargeback, delayed, expired
//     (also seen uppercased: APPROVED, CANCELLED, CHARGEBACK, COMPLETE,
//     EXPIRED, NO_FUNDS, OVERDUE, PARTIALLY_REFUNDED, PRE_ORDER,
//     PRINTED_BILLET, PROCESSING_TRANSACTION, PROTESTED, REFUNDED,
//     STARTED, UNDER_ANALISYS, WAITING_PAYMENT — both casings accepted
//     below).
//   - `subscription_status` enum: active, canceled, past_due, expired,
//     started, inactive.
//   - Hottok is a static per-account token Hotmart includes in the
//     request for the receiver to compare — NOT confirmed as an HMAC
//     signature (a third-party guide claimed X-Hotmart-Signature/HMAC;
//     discarded as unreliable, contradicted every official-domain result).
//
// NOT CONFIRMED (flagged, never guessed as fact):
//   - The exact nested field paths inside the newer "2.0.0" payload's
//     `data.purchase` / `data.subscription` objects (only `data.product`,
//     `data.buyer`, `data.affiliates` were confirmed). This normalizer
//     therefore parses the CONFIRMED flat shape as its primary path; a
//     2.0.0-shaped payload that doesn't also carry the flat fields is
//     logged as `unrecognized_shape` and the event is held (never
//     silently guessed at) — see hotmart-integration-report.md §risks for
//     why this must be re-verified against a real "Send test event"
//     before go-live.
//   - Whether Hotmart offers any "custom data / tracking parameter"
//     passthrough analogous to Lemon Squeezy's checkout_data.custom
//     (which is how the LS webhook links a purchase to a user_id without
//     ever trusting the buyer's email). Not found in Fase B research.
//     Buyer linking therefore falls back to email matching by default
//     (see hotmart-buyer-linking.ts) — a materially weaker guarantee than
//     the Lemon Squeezy checkout flow, documented as an open risk.

export type HotmartNormalizedEvent = {
  // Our own internal vocabulary — see the RPC's allowlist.
  eventType:
    | "purchase_approved"
    | "renewal_approved"
    | "subscription_cancelled"
    | "refund"
    | "chargeback"
    | "chargeback_reversed"
    | "payment_failed"
    | "reactivation"
    | "plan_change"
    | "subscription_expired"
    | "unrecognized_shape"
    | "ignored";
  rawStatus: string | null;
  transactionId: string | null;
  subscriptionId: string | null; // Hotmart subscriber_code
  productId: string | null;
  offerId: string | null;
  buyerEmail: string | null;
  currency: string | null;
  fullPrice: number | null;
  hottok: string | null;
  // Best-effort out-of-order-event signal, ISO 8601 or null. `creation_date`
  // is a CONFIRMED top-level field of Hotmart's 2.0.0 payload (a unix
  // timestamp, per Fase B research) but was never confirmed present in the
  // flat/1.0.0 format this normalizer otherwise targets — real deliveries
  // may or may not include it. When present, it's forwarded to
  // process_hotmart_event's p_provider_updated_at (the same out-of-order
  // guard already proven for Lemon Squeezy); when absent, that guard is
  // simply inactive for this event (matches the RPC's own NULL-safe
  // behavior — never blocks a mutation, never a hard failure). This is
  // exactly the residual gap documented in
  // docs/hotmart-integration-report.md §15 (risk: 2.0.0 payload shape not
  // fully confirmed) — not silently assumed solved.
  providerUpdatedAt: string | null;
};

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

// Case-insensitive lookup: Hotmart documentation shows both
// capitalized (Prod, Off, Transaction) and lowercase (status,
// subscriber_code) field names depending on the doc page — never
// confirmed which casing a real delivery actually uses, so this reads
// whichever is present rather than assuming one.
function pick(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (obj[name] !== undefined) return obj[name];
    const lower = name.toLowerCase();
    const upper = name[0].toUpperCase() + name.slice(1);
    if (obj[lower] !== undefined) return obj[lower];
    if (obj[upper] !== undefined) return obj[upper];
  }
  return undefined;
}

// Maps Hotmart's raw purchase/subscription status onto our internal
// vocabulary. Anything not explicitly recognized maps to "ignored" (never
// a default guess at a financial action) so an unrecognized status can
// never accidentally grant or revoke access.
function mapStatusToEventType(rawStatus: string | null, subscriptionStatus: string | null): HotmartNormalizedEvent["eventType"] {
  const s = (rawStatus ?? "").toLowerCase();
  const subS = (subscriptionStatus ?? "").toLowerCase();

  if (s === "approved" || s === "completed" || s === "complete") return "purchase_approved";
  if (s === "refunded" || s === "partially_refunded") return "refund";
  if (s === "chargeback") return "chargeback";
  if (s === "dispute" || s === "protested") return "chargeback"; // treated as chargeback-equivalent per Fase F policy (aggressive, fraud risk)
  if (s === "canceled" || s === "cancelled") return "subscription_cancelled";
  if (s === "expired") return "subscription_expired";
  if (s === "delayed" || s === "overdue" || s === "no_funds" || s === "billet_printed" || s === "printed_billet" || s === "waiting_payment")
    return "payment_failed";
  if (s === "blocked" || s === "under_analisys" || s === "processing_transaction" || s === "started" || s === "pre_order")
    return "ignored"; // in-flight/ambiguous — never a financial action on an ambiguous state

  // Fall back to the dedicated subscription_status field when the
  // purchase-level status didn't resolve to anything (e.g. a
  // subscription-lifecycle-only delivery with no `status` of its own).
  if (subS === "active" || subS === "started") return "ignored"; // activation is driven by the purchase event, not this field alone
  if (subS === "canceled" || subS === "cancelled") return "subscription_cancelled";
  if (subS === "past_due") return "payment_failed";
  if (subS === "expired") return "subscription_expired";
  if (subS === "inactive") return "ignored";

  return "unrecognized_shape";
}

export function normalizeHotmartPayload(payload: unknown): HotmartNormalizedEvent {
  if (typeof payload !== "object" || payload === null) {
    return {
      eventType: "unrecognized_shape",
      rawStatus: null,
      transactionId: null,
      subscriptionId: null,
      productId: null,
      offerId: null,
      buyerEmail: null,
      currency: null,
      fullPrice: null,
      hottok: null,
      providerUpdatedAt: null,
    };
  }
  const obj = payload as Record<string, unknown>;

  const rawStatus = asString(pick(obj, "status"));
  const subscriptionStatus = asString(pick(obj, "subscription_status"));
  const buyerEmailRaw = asString(pick(obj, "email"));

  // `creation_date` (2.0.0, confirmed) is a unix timestamp — accept
  // either seconds or milliseconds heuristically (values below the
  // year-2001-in-ms threshold are treated as seconds), since the exact
  // unit wasn't independently confirmed either. Any parse failure yields
  // null, never a fabricated "now" (that would defeat the whole point of
  // an out-of-order guard).
  const creationDateRaw = asNumber(pick(obj, "creation_date"));
  let providerUpdatedAt: string | null = null;
  if (creationDateRaw !== null && creationDateRaw > 0) {
    const ms = creationDateRaw < 1e12 ? creationDateRaw * 1000 : creationDateRaw;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) providerUpdatedAt = date.toISOString();
  }

  return {
    eventType: mapStatusToEventType(rawStatus, subscriptionStatus),
    rawStatus: rawStatus ?? subscriptionStatus,
    transactionId: asString(pick(obj, "transaction")),
    subscriptionId: asString(pick(obj, "subscriber_code")),
    productId: asString(pick(obj, "prod")),
    offerId: asString(pick(obj, "off")),
    buyerEmail: buyerEmailRaw ? buyerEmailRaw.trim().toLowerCase() : null,
    currency: asString(pick(obj, "currency")),
    fullPrice: asNumber(pick(obj, "full_price")),
    hottok: asString(pick(obj, "hottok")),
    providerUpdatedAt,
  };
}

// Constant-time comparison against the configured account Hottok. Never a
// simple `===` (timing side-channel), same posture as every other secret
// comparison in this codebase (see verifyWebhookSignature in
// lemon-squeezy.server.ts, secretMatches in the internal reconcile-credits
// route).
export function verifyHottok(provided: string | null, configured: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
