import { timingSafeEqual } from "node:crypto";

// Server-only. Normalizes Hotmart's webhook payload into the internal,
// provider-agnostic event vocabulary process_hotmart_event's p_event_type
// expects (see supabase/migrations/20260729010000_process_hotmart_event_rpc.sql).
//
// REBUILT 2026-07-19 against REAL captured evidence (Fase 8C), replacing
// the earlier version built only from official-docs research. The real
// payload is nested (Hotmart's "2.0.0" webhook), not the flat/1.0.0 shape
// this file originally targeted — confirmed live by sanitized structural
// logging (field NAMES only, never values) against a real Hotmart
// delivery. See docs/hotmart-integration-report.md §24 for the full
// captured structure and what remains genuinely unconfirmed below.
//
// CONFIRMED REAL FIELD PATHS (structure, from a live delivery):
//   top-level: event, id, creation_date, version, hottok
//   data.product: { id, ucode, name, support_email, ... }
//   data.purchase: { transaction, status, offer, approved_date, order_date,
//                     price, full_price, buyer_ip, payment, business_model, ... }
//   data.subscription: { subscriber, plan, status }
//   data.buyer: { email, name, document, ... }
//
// CONFIRMED REAL VALUE (from official Fase B research, an actual example
// payload on developers.hotmart.com): top-level `event` = "PURCHASE_APPROVED"
// is a real, confirmed value.
//
// NOT CONFIRMED (best-effort, defensive, documented, never assumed
// correct without a live check): the exact sibling `event` values for the
// other 11 configured events (PURCHASE_CANCELED / PURCHASE_REFUNDED /
// PURCHASE_CHARGEBACK / etc. are Hotmart's own well-documented naming
// convention, inferred by consistency with PURCHASE_APPROVED, not
// individually confirmed); the exact field name one level deeper than
// `data.purchase.offer` (assumed `.code`, matching the `?off=` checkout
// URL convention) and `data.subscription.subscriber` (assumed `.code`,
// matching the 1.0.0 flat format's `subscriber_code` naming) — both were
// captured only as `"object"` in the structural log (3 levels of depth),
// never expanded further. A wrong guess here degrades gracefully to
// `null` (never a crash, never a wrong value silently accepted) and is
// visible in `parseWarnings`.

export type HotmartEventType =
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
  | "no_action_required" // recognized event/status, correctly understood, deliberately no mutation (e.g. billing date change, an in-flight/ambiguous purchase status)
  | "unsupported" // authenticated, well-formed `data` block, but event/status value not in any known mapping — needs admin review, never guessed
  | "invalid_payload"; // authenticated but missing the minimum expected structure entirely

export type HotmartNormalizedEvent = {
  eventType: HotmartEventType;
  rawEventName: string | null; // top-level `event`, e.g. "PURCHASE_APPROVED" — the PRIMARY classification signal
  rawStatus: string | null; // data.purchase.status / data.subscription.status — SECONDARY signal, also stored for audit
  externalEventId: string | null; // top-level `id` — Hotmart's own webhook envelope id, stored for audit, never the sole idempotency key (stability across resends unconfirmed)
  transactionId: string | null; // data.purchase.transaction
  subscriptionId: string | null; // data.subscription.subscriber.code — UNCONFIRMED exact field name, see header
  productId: string | null; // data.product.id
  productUcode: string | null; // data.product.ucode
  offerId: string | null; // data.purchase.offer.code — UNCONFIRMED exact field name, see header
  buyerEmail: string | null; // data.buyer.email
  currency: string | null; // best-effort from data.purchase.price / full_price — UNCONFIRMED sub-field name
  fullPrice: number | null;
  hottok: string | null; // top-level hottok field (CONFIRMED present and matching in a real delivery)
  providerUpdatedAt: string | null; // from creation_date (top-level, CONFIRMED present)
  isTestPayload: boolean; // heuristic only, never used to bypass auth/idempotency — see isLikelyTestPayload()
  parseWarnings: string[]; // expected-but-missing fields, for admin observability — never silently swallowed
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Case-insensitive single-level field lookup — Hotmart documentation
// shows both capitalized and lowercase field names on different doc
// pages, never confirmed which casing a real delivery uses at any given
// level.
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

// Safely walks a dotted path of case-insensitive field lookups, e.g.
// pickPath(payload, ["data", "purchase", "transaction"]). Returns
// undefined (never throws) the instant any level is missing or isn't an
// object — this is exactly the "no asumas que todos los eventos
// contienen los mismos bloques" defensive requirement.
function pickPath(obj: unknown, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = pick(current, segment);
  }
  return current;
}

// Normalizes a Hotmart event-name-like string ("PURCHASE_APPROVED",
// "approved", "PURCHASE_REFUNDED", "chargeback") down to a bare keyword
// for matching, by stripping a leading "purchase_"/"subscription_"
// prefix and lowercasing — lets one mapping table serve the top-level
// `event` field, `data.purchase.status`, `data.subscription.status`, and
// (for backward compatibility) the old flat 1.0.0 fields, without
// duplicating the table four times.
function normalizeKeyword(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^purchase[_-]/, "")
    .replace(/^subscription[_-]/, "");
}

// The one mapping table — every classification signal (event name or
// status, from any field path) is normalized to a keyword and looked up
// here exactly once. Never a default guess at a financial action for an
// unrecognized keyword (falls through to "unsupported" in the caller).
const KEYWORD_TO_EVENT_TYPE: Record<string, HotmartEventType> = {
  approved: "purchase_approved",
  complete: "purchase_approved",
  completed: "purchase_approved",
  refunded: "refund",
  refund: "refund",
  partially_refunded: "refund",
  chargeback: "chargeback",
  dispute: "chargeback",
  disputed: "chargeback",
  protested: "chargeback",
  protest: "chargeback",
  chargeback_reversed: "chargeback_reversed",
  dispute_won: "chargeback_reversed",
  canceled: "subscription_cancelled",
  cancelled: "subscription_cancelled",
  cancellation: "subscription_cancelled",
  expired: "subscription_expired",
  delayed: "payment_failed",
  overdue: "payment_failed",
  no_funds: "payment_failed",
  billet_printed: "no_action_required", // a boleto was generated, not yet paid — nothing to grant or revoke yet
  printed_billet: "no_action_required",
  waiting_payment: "no_action_required",
  past_due: "payment_failed",
  reactivated: "reactivation",
  reactivation: "reactivation",
  active: "no_action_required", // activation itself is driven by the purchase/renewal event, not this status alone
  started: "no_action_required",
  blocked: "no_action_required",
  under_analisys: "no_action_required",
  under_analysis: "no_action_required",
  processing_transaction: "no_action_required",
  pre_order: "no_action_required",
  inactive: "no_action_required",
  // Dedicated-webhook event names (Fase B research found these as
  // SEPARATE webhook types with their own URLs on developers.hotmart.com
  // — switch-plan-webhook, cancel-subscription-webhook,
  // update-subscription-charge-date — exact `event` string values for
  // each were never confirmed; matched here by substring in
  // classifyEvent() below, not by this exact-keyword table, since the
  // real string is more likely something like
  // "SWITCH_PLAN"/"SUBSCRIPTION_CANCELLATION"/"UPDATE_SUBSCRIPTION_CHARGE_DATE"
  // that normalizeKeyword()'s simple prefix-strip won't reduce to a
  // single word the way "PURCHASE_*" does.
};

function classifyByKeyword(raw: string | null): HotmartEventType | null {
  if (!raw) return null;
  const kw = normalizeKeyword(raw);
  if (kw in KEYWORD_TO_EVENT_TYPE) return KEYWORD_TO_EVENT_TYPE[kw];
  return null;
}

// Handles the three dedicated-webhook event names by substring match
// (UNCONFIRMED exact strings — see the header comment) rather than exact
// keyword lookup, since none of these are simple PURCHASE_*/status
// values.
function classifyDedicatedWebhookEvent(rawEventName: string | null): HotmartEventType | null {
  if (!rawEventName) return null;
  const upper = rawEventName.toUpperCase();
  if (upper.includes("SWITCH_PLAN") || upper.includes("PLAN_CHANGE") || upper.includes("CHANGE_PLAN")) return "plan_change";
  if (upper.includes("SUBSCRIPTION_CANCEL") || upper.includes("CANCEL_SUBSCRIPTION")) return "subscription_cancelled";
  if (upper.includes("CHARGE_DATE") || upper.includes("UPDATE_SUBSCRIPTION")) return "no_action_required";
  return null;
}

// buyer domains/markers Hotmart's own "Send test event" feature is known
// to use — heuristic only, NEVER used to bypass auth/idempotency/RLS
// (per the task's explicit rule). Only changes the final classification
// label so a genuine test delivery doesn't get flagged as "unsupported"/
// reviewed as if it were a real unexplained event.
function isLikelyTestPayload(buyerEmail: string | null, productName: unknown, productUcode: string | null): boolean {
  if (buyerEmail && /@(test\.|example\.com$|hotmart\.com$)/i.test(buyerEmail)) return true;
  if (typeof productName === "string" && /\btest\b/i.test(productName)) return true;
  if (productUcode && /test/i.test(productUcode)) return true;
  return false;
}

export function normalizeHotmartPayload(payload: unknown): HotmartNormalizedEvent {
  const warnings: string[] = [];

  if (!isRecord(payload)) {
    return {
      eventType: "invalid_payload",
      rawEventName: null,
      rawStatus: null,
      externalEventId: null,
      transactionId: null,
      subscriptionId: null,
      productId: null,
      productUcode: null,
      offerId: null,
      buyerEmail: null,
      currency: null,
      fullPrice: null,
      hottok: null,
      providerUpdatedAt: null,
      isTestPayload: false,
      parseWarnings: ["payload is not a JSON object"],
    };
  }

  // hottok and the envelope fields are always top-level, confirmed live.
  const hottok = asString(pick(payload, "hottok"));
  const externalEventId = asString(pick(payload, "id"));
  const rawEventName = asString(pick(payload, "event"));
  const creationDateRaw = asNumber(pick(payload, "creation_date"));
  let providerUpdatedAt: string | null = null;
  if (creationDateRaw !== null && creationDateRaw > 0) {
    const ms = creationDateRaw < 1e12 ? creationDateRaw * 1000 : creationDateRaw;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) providerUpdatedAt = date.toISOString();
  }

  const dataBlock = pick(payload, "data");
  const hasNestedShape = isRecord(dataBlock);

  // Nested (confirmed real) paths first; flat/1.0.0 paths as a fallback
  // for any delivery that turns out to use the older format (never
  // observed live yet, but the original design target — kept for
  // graceful degradation, not removed).
  let transactionId: string | null = null;
  let purchaseStatus: string | null = null;
  let offerId: string | null = null;
  let productId: string | null = null;
  let productUcode: string | null = null;
  let productName: unknown = null;
  let subscriptionId: string | null = null;
  let subscriptionStatus: string | null = null;
  let buyerEmail: string | null = null;
  let currency: string | null = null;
  let fullPrice: number | null = null;

  if (hasNestedShape) {
    transactionId = asString(pickPath(payload, ["data", "purchase", "transaction"]));
    purchaseStatus = asString(pickPath(payload, ["data", "purchase", "status"]));
    // UNCONFIRMED exact sub-field — see header comment.
    offerId = asString(pickPath(payload, ["data", "purchase", "offer", "code"])) ?? asString(pickPath(payload, ["data", "purchase", "offer", "id"]));
    productId = asString(pickPath(payload, ["data", "product", "id"]));
    productUcode = asString(pickPath(payload, ["data", "product", "ucode"]));
    productName = pickPath(payload, ["data", "product", "name"]);
    // UNCONFIRMED exact sub-field — see header comment.
    subscriptionId =
      asString(pickPath(payload, ["data", "subscription", "subscriber", "code"])) ??
      asString(pickPath(payload, ["data", "subscription", "subscriber", "id"]));
    subscriptionStatus = asString(pickPath(payload, ["data", "subscription", "status"]));
    buyerEmail = asString(pickPath(payload, ["data", "buyer", "email"]));
    // UNCONFIRMED exact sub-fields — best-effort candidates only.
    currency =
      asString(pickPath(payload, ["data", "purchase", "price", "currency_value"])) ??
      asString(pickPath(payload, ["data", "purchase", "full_price", "currency_value"]));
    fullPrice =
      asNumber(pickPath(payload, ["data", "purchase", "full_price", "value"])) ??
      asNumber(pickPath(payload, ["data", "purchase", "price", "value"]));

    if (!transactionId && !subscriptionId) warnings.push("neither data.purchase.transaction nor data.subscription.subscriber.code resolved");
    if (!offerId) warnings.push("data.purchase.offer.code did not resolve (unconfirmed field name)");
    if (!buyerEmail) warnings.push("data.buyer.email did not resolve");
  } else {
    // Flat/1.0.0 fallback — never confirmed live, kept for graceful
    // degradation only.
    transactionId = asString(pick(payload, "transaction"));
    purchaseStatus = asString(pick(payload, "status"));
    subscriptionStatus = asString(pick(payload, "subscription_status"));
    offerId = asString(pick(payload, "off"));
    productId = asString(pick(payload, "prod"));
    const flatEmail = asString(pick(payload, "email"));
    buyerEmail = flatEmail;
    currency = asString(pick(payload, "currency"));
    fullPrice = asNumber(pick(payload, "full_price"));
    subscriptionId = asString(pick(payload, "subscriber_code"));
    warnings.push("payload has no top-level 'data' object — used flat/1.0.0 field fallback, never confirmed live");
  }

  buyerEmail = buyerEmail ? buyerEmail.trim().toLowerCase() : null;

  const rawStatus = purchaseStatus ?? subscriptionStatus;

  // Classification, in priority order: dedicated-webhook event name
  // match, then top-level `event` keyword, then nested status, never a
  // silent default to a financial action.
  let eventType: HotmartEventType | null =
    classifyDedicatedWebhookEvent(rawEventName) ?? classifyByKeyword(rawEventName) ?? classifyByKeyword(purchaseStatus) ?? classifyByKeyword(subscriptionStatus);

  if (!eventType) {
    // Authenticated later by the caller; here we only know whether the
    // payload had ANY recognizable identity at all.
    eventType = hasNestedShape || rawEventName || rawStatus ? "unsupported" : "invalid_payload";
    if (eventType === "unsupported") warnings.push(`unrecognized event/status combination: event=${rawEventName ?? "null"} status=${rawStatus ?? "null"}`);
  }

  const isTestPayload = isLikelyTestPayload(buyerEmail, productName, productUcode);

  return {
    eventType,
    rawEventName,
    rawStatus,
    externalEventId,
    transactionId,
    subscriptionId,
    productId,
    productUcode,
    offerId,
    buyerEmail,
    currency,
    fullPrice,
    hottok,
    providerUpdatedAt,
    isTestPayload,
    parseWarnings: warnings,
  };
}

// Constant-time comparison against the configured account Hottok. Never a
// simple `===` (timing side-channel), same posture as every other secret
// comparison in this codebase (see verifyWebhookSignature in
// lemon-squeezy.server.ts, secretMatches in the internal reconcile-credits
// route). Checks the CONFIRMED body field first (verified live: present
// and matching on a real delivery), then falls back to the
// `x-hotmart-hottok` header (also observed present on every real
// delivery, though never required since the body field already matched)
// — accepting either means a delivery missing one but not the other still
// authenticates correctly.
export function verifyHottok(bodyHottok: string | null, headerHottok: string | null, configured: string): boolean {
  return verifyOne(bodyHottok, configured) || verifyOne(headerHottok, configured);
}

// Single-value constant-time check — exported so the webhook route can
// authenticate via the header ALONE, before ever parsing the body as
// JSON (Fase C hotfix, 2026-07-19: the route must validate the Hottok
// before doing any other work, including rate limiting — see
// docs/hotmart-integration-report.md §30). verifyHottok() above still
// covers the combined body-or-header case for the post-parse path.
export function verifyOne(provided: string | null, configured: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Best-effort, crash-proof extraction of just the top-level `hottok`
// field from an already-parsed JSON value — used by the route's
// pre-rate-limit auth fallback (body-only Hottok, no header) without
// running the full normalizer. Never throws on a malformed/unexpected
// shape.
export function extractHottokFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>).hottok;
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Structural-only currency sanity check (ISO 4217 shape: exactly 3
// letters) — deliberately NOT an equality check against any specific
// currency. Hotmart legitimately charges international buyers in their
// local currency for an offer configured with a USD reference price
// (confirmed live 2026-07-20: a real POSTULPRO30 purchase was charged in
// ARS) — the currency itself is never the security boundary for which
// plan to grant (offer_id already is, see hotmart.server.ts's
// findMappingByIds). This only catches a genuinely malformed/garbage
// value, which is a real structural problem worth hard-blocking on,
// never a legitimate-but-different currency.
export function isPlausibleCurrencyCode(value: string | null): boolean {
  if (!value) return false;
  return /^[A-Za-z]{3}$/.test(value);
}
