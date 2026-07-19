import { createHash } from "node:crypto";
import type { HotmartNormalizedEvent } from "./normalize";

// Idempotency key strategy for the Hotmart webhook — see
// docs/hotmart-integration-report.md §idempotencia for the full reasoning
// and its documented limitation.
//
// Never keyed on: email alone, a local/received-at timestamp, price, or
// product name (explicitly forbidden — none of those distinguish a
// genuine retry from a genuinely new event, and price/name aren't even
// stable identifiers).
//
// When a transaction_id is present (purchase/renewal/refund/chargeback —
// every event that represents an actual charge or its reversal), the key
// is transaction_id + event_type: a real retry/redelivery of the same
// transaction always carries the same transaction_id, while a genuinely
// new transaction (e.g. the next month's renewal) gets a new one from
// Hotmart itself — so distinct legitimate events on the same subscription
// naturally produce distinct keys without needing a timestamp.
//
// When there is no transaction_id (pure subscription-lifecycle
// announcements — cancellation, reactivation, expiration with no
// attached charge), the key falls back to subscription_id + event_type +
// raw_status. Documented limitation: two genuinely separate occurrences
// of the identical status on the identical subscription (e.g. cancel,
// reactivate, cancel again with byte-identical status text) would
// collide and the second would be treated as "already processed" — this
// could only be resolved with a resource-level timestamp, which was not
// confirmed to exist in Hotmart's flat/1.0.0 payload during Fase B
// research (see normalize.ts's header comment). Flagged as an open risk
// for live verification once real test events exist, not silently
// assumed safe.
export function buildIdempotencyKey(event: HotmartNormalizedEvent): string {
  const parts = event.transactionId
    ? ["txn", event.transactionId, event.eventType]
    : ["sub", event.subscriptionId ?? "no-subscription-id", event.eventType, event.rawStatus ?? "no-status"];
  return createHash("sha256").update(parts.join(":")).digest("hex");
}
