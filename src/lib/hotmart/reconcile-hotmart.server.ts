import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { HotmartNormalizedEvent } from "@/lib/hotmart/normalize";
import { processEvent, log } from "@/lib/hotmart/process-event.server";

// Shared Hotmart reconciliation runner — the ONLY place (besides the
// public webhook route itself) that ever calls processEvent, and the ONLY
// place that calls reconcile_hotmart_stale. Used by tasks/reconcile-hotmart.ts
// (the Nitro Task, invoked automatically by the Worker's own scheduled()
// handler on the shared */5 cron — see vite.config.ts's scheduledTasks).
//
// Fase 5 (autonomous entitlement recovery, see
// docs/hotmart-integration-report.md §5-6): the founder explicitly and
// repeatedly rejected any recovery path requiring a manual Hotmart resend,
// a founder-run script, or exposing BILLING_RPC_SECRET/HOTMART_HOTTOK. This
// module is the mechanism that satisfies that constraint — it runs
// entirely server-side, inside the Worker's own environment (where
// BILLING_RPC_SECRET is already bound as a real secret, exactly like the
// public webhook route uses it), and needs no payload, no header, no
// caller-supplied secret at all.
//
// reconcileFailedEvents finds 'failed' / 'pending_link' rows that carry
// enough identity to retry (a transaction id, plus either a mapped
// product+offer or an already-linked subscription), reconstructs a
// HotmartNormalizedEvent from the ALREADY-STORED ledger columns (no raw
// payload needed — every field processEvent uses was already extracted and
// persisted at ingest time), and replays it through the exact same
// processEvent the public webhook uses. This is safe to do automatically
// because:
//   - Hottok is never re-checked and never needed — the row's mere
//     existence already proves it was authenticated when first received
//     (hotmart_events has zero anon/authenticated grants; only an
//     already-authenticated webhook delivery or this service-role runner
//     ever writes to it).
//   - process_hotmart_event applies SET (never increment) semantics, and
//     is itself keyed by the row's own deterministic idempotency_key —
//     replaying the same row twice, or two rows for the same purchase
//     (e.g. Hotmart's "Compra aprobada" and "Compra completa" both landing
//     separately), converges to one commercial effect, never a double
//     grant (see process-event.server.ts's comment on effectiveEventType).
//   - A lightweight compare-and-swap claim (conditional UPDATE keyed off
//     the row's last-seen status) prevents two concurrent reconciler runs
//     — or a reconciler run racing a live webhook redelivery of the same
//     row — from both processing the same row at once.
// Rows are capped at MAX_ATTEMPTS before being flipped to 'failed_terminal'
// (see 20260802000000_hotmart_events_failed_terminal.sql) instead of
// retried forever — a genuinely broken row stays visible for admin review
// rather than looping.

export const MAX_RECONCILE_ATTEMPTS = 5;

export type HotmartReconciliationSummary = {
  expired_subscriptions: number;
  stuck_events_flagged: number;
  reconciled: number;
  still_recoverable: number;
  moved_to_terminal: number;
  skipped_locked: number;
};

export async function runHotmartReconciliation(
  supabase: SupabaseClient<Database>,
  billingRpcSecret: string,
  batchLimit: number,
  retryBatchLimit: number,
): Promise<{ ok: true; summary: HotmartReconciliationSummary } | { ok: false; errorMessage: string }> {
  const { data, error } = await supabase.rpc("reconcile_hotmart_stale", { p_batch_limit: batchLimit });
  if (error) {
    log({ scope: "hotmart_reconcile_run", result: "error", error: error.message });
    return { ok: false, errorMessage: error.message };
  }
  const staleSummary = data?.[0] ?? { expired_subscriptions: 0, stuck_events_flagged: 0 };

  const retrySummary = await reconcileFailedEvents(supabase, billingRpcSecret, retryBatchLimit);

  const summary: HotmartReconciliationSummary = { ...staleSummary, ...retrySummary };
  log({ scope: "hotmart_reconcile_run", result: "ok", summary });
  return { ok: true, summary };
}

export async function reconcileFailedEvents(
  supabase: SupabaseClient<Database>,
  billingRpcSecret: string,
  limit: number,
): Promise<{ reconciled: number; still_recoverable: number; moved_to_terminal: number; skipped_locked: number }> {
  let reconciled = 0;
  let stillRecoverable = 0;
  let movedToTerminal = 0;
  const skippedLocked = 0;

  const { data: candidates, error } = await supabase
    .from("hotmart_events")
    .select("id, idempotency_key, external_event_id, event_type, transaction_id, subscription_id, product_id, offer_id, buyer_email, processing_status, processing_attempts")
    .in("processing_status", ["failed", "pending_link"])
    .lt("processing_attempts", MAX_RECONCILE_ATTEMPTS)
    .not("transaction_id", "is", null)
    .order("received_at", { ascending: true })
    .limit(limit);

  if (error || !candidates) {
    log({ scope: "hotmart_reconcile_retry", result: "candidate_query_failed", error: error?.message });
    return { reconciled, still_recoverable: stillRecoverable, moved_to_terminal: movedToTerminal, skipped_locked: skippedLocked };
  }

  for (const row of candidates) {
    // A row needs SOME identity to meaningfully retry: either a mapped
    // product+offer (initial purchase/plan-change class) or an already
    // linked subscription (lifecycle event class). Neither present means
    // there is nothing new to learn by retrying — left as-is for admin
    // review, never force-attempted.
    if (!(row.product_id && row.offer_id) && !row.subscription_id) continue;

    // Compare-and-swap claim: only proceed if the row is STILL in the
    // status we just read it as. Prevents this reconciler run from racing
    // a concurrent reconciler run or a live webhook redelivery of the same
    // row — whichever claims first wins, the loser's update affects 0 rows
    // and is skipped rather than double-processed.
    const nextAttempts = row.processing_attempts + 1;
    const { data: claimed, error: claimError } = await supabase
      .from("hotmart_events")
      .update({ processing_status: "pending", processing_attempts: nextAttempts, last_error: null })
      .eq("id", row.id)
      .eq("processing_status", row.processing_status)
      .select("id")
      .maybeSingle();

    if (claimError || !claimed) continue;

    const event: HotmartNormalizedEvent = {
      eventType: row.event_type as HotmartNormalizedEvent["eventType"],
      rawEventName: null,
      rawStatus: null,
      externalEventId: row.external_event_id,
      transactionId: row.transaction_id,
      subscriptionId: row.subscription_id,
      productId: row.product_id,
      productUcode: null,
      offerId: row.offer_id,
      buyerEmail: row.buyer_email,
      // Not persisted on the ledger row (see hotmart_events schema) — the
      // currency/amount sanity checks in processEvent are skipped on a
      // reconciled replay as a result, which is safe: they were only ever
      // advisory guards on top of the real authority (offer_id), never
      // themselves a source of correctness.
      currency: null,
      fullPrice: null,
      hottok: null,
      providerUpdatedAt: null,
      isTestPayload: false,
      parseWarnings: [],
    };

    const outcome = await processEvent({
      supabaseAdmin: supabase,
      event,
      hotmartEventRowId: row.id,
      billingRpcSecret,
    });

    log({ scope: "hotmart_reconcile_retry", result: outcome.result, event_type: row.event_type, attempt: nextAttempts, hotmart_event_id: row.id });

    if (outcome.result === "processed" || outcome.result === "no_action_required" || outcome.result === "ignored_test") {
      reconciled += 1;
      continue;
    }

    // Only 'failed'/'pending_link' remain eligible for another reconciler
    // pass (see the candidate query above) — any other outcome
    // (unmapped_offer, unsupported, invalid_payload) is processEvent's own
    // distinct, meaningful terminal-ish classification and is left exactly
    // as it wrote it, never overwritten here.
    if (outcome.result !== "failed" && outcome.result !== "pending_link") continue;

    if (nextAttempts >= MAX_RECONCILE_ATTEMPTS) {
      await supabase
        .from("hotmart_events")
        .update({ processing_status: "failed_terminal", last_error: `reconciler gave up after ${nextAttempts} attempts` })
        .eq("id", row.id);
      movedToTerminal += 1;
    } else {
      stillRecoverable += 1;
    }
  }

  return { reconciled, still_recoverable: stillRecoverable, moved_to_terminal: movedToTerminal, skipped_locked: skippedLocked };
}
