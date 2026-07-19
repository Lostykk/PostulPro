import { createHash } from "node:crypto";
import type { HotmartNormalizedEvent } from "./normalize";

// Idempotency key strategy for the Hotmart webhook — REBUILT 2026-07-19
// (Fase 8C) after a confirmed live incident: the previous version fell
// back to subscriptionId+eventType+rawStatus whenever transactionId was
// null, and because the old normalizer failed against the real nested
// payload, transactionId/subscriptionId/eventType were IDENTICAL
// (null/null/"unrecognized_shape") for every distinct real event —
// collapsing 12 structurally different Hotmart deliveries onto one
// ledger row. Confirmed empirically: exactly 1 row in hotmart_events
// after resending Compra aprobada, Compra reembolsada, etc.; every
// resend after the first returned "already_processed" for an event that
// had never actually been examined. See
// docs/hotmart-integration-report.md §24-25.
//
// Priority order (per the Fase 8C mandate):
//   1. The official webhook envelope id (top-level `id`, CONFIRMED present
//      on every real delivery), when it resolved.
//   2. A safe combination of: event type, transaction id, subscription/
//      subscriber code, offer code, product id, and a PROVIDER-issued
//      stable timestamp (creation_date → providerUpdatedAt) — never a
//      locally-received-at timestamp, which would make every retry a
//      "new" event.
//   3. A fallback ONLY for payloads with no resolvable identity at all,
//      namespaced separately for test vs. non-test so it can never
//      collide with a real event's identity space.
//
// Priority 1's assumption — that Hotmart's `id` is stable across a
// redelivery/resend of the SAME event — was never independently
// confirmed live (only that the field exists and is a string). To avoid
// silently trusting an unconfirmed assumption for the sole uniqueness
// signal, priority-1 keys are salted with eventType (defense in depth,
// zero cost if the assumption holds) and this remains a documented open
// risk, not a silently-assumed-safe one.
//
// Explicitly never keyed on: buyer email, price, product name, or a
// locally-received-at timestamp — none of those distinguish a genuine
// retry from a genuinely new event, and none are guaranteed stable.
//
// Explicitly required and preserved by this design: a purchase-approved
// and a purchase-refunded of the SAME transaction keep different
// identities (eventType is always part of the key, at every priority
// level); a resend of the identical event is a no-op (same inputs →
// same hash); an incomplete/degenerate payload can never collide with,
// or overwrite, a valid row (priority 3 is a disjoint namespace).
export function buildIdempotencyKey(event: HotmartNormalizedEvent): string {
  if (event.externalEventId) {
    return hashParts(["id", event.externalEventId, event.eventType]);
  }

  const identityParts = [
    event.transactionId,
    event.subscriptionId,
    event.offerId,
    event.productId,
  ].filter((p): p is string => Boolean(p));

  if (identityParts.length > 0) {
    return hashParts([
      "combo",
      event.eventType,
      event.transactionId ?? "no-transaction",
      event.subscriptionId ?? "no-subscription",
      event.offerId ?? "no-offer",
      event.productId ?? "no-product",
      event.providerUpdatedAt ?? "no-provider-timestamp",
    ]);
  }

  // No resolvable identity whatsoever — only reachable for a genuinely
  // degenerate payload (which the caller should already be rejecting
  // with 400/422 before ever computing a key for a non-test event; this
  // fallback exists so the function itself never throws or returns an
  // ambiguous value). Namespaced separately per test/non-test so a
  // no-identity test payload can never collide with, or be mistaken
  // for, a no-identity real one.
  const namespace = event.isTestPayload ? "test-fallback" : "unidentified-fallback";
  return hashParts([
    namespace,
    event.eventType,
    event.rawEventName ?? "no-event-name",
    event.rawStatus ?? "no-status",
    event.providerUpdatedAt ?? "no-provider-timestamp",
  ]);
}

function hashParts(parts: string[]): string {
  return createHash("sha256").update(parts.join(":")).digest("hex");
}
