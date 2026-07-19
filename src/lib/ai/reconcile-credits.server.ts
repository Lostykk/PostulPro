import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Shared reconciliation runner — the ONLY place that invokes
// reconcile_stale_reservations_v2 (SQL logic lives entirely in
// supabase/migrations/20260728000000_reservation_job_evidence.sql, never
// duplicated here). Used today by the HTTP-triggered path
// (routes/api/internal/reconcile-credits.ts); designed to be the same
// function a genuine Cloudflare scheduled() handler would call too, once
// one is wired up — see docs/premium-redesign-report.md for why that
// requires a Nitro/Vite build-config change (server/plugins/ auto-
// discovery isn't enabled in this project today) this task didn't make,
// and for the immediately-available alternative (an external scheduler
// calling the existing HTTP endpoint) that needs no code or build
// changes at all.

const MAX_BATCH_LIMIT = 500;
const DEFAULT_BATCH_LIMIT = 200;

export type ReconciliationSummary = {
  ok: boolean;
  batchLimit: number;
  inspected: number;
  consumed: number;
  refunded: number;
  reservedNoEvidence: number;
  inconsistent: number;
  durationMs: number;
  errorMessage?: string;
};

// Structured, secret-free observability — only counts, an outcome
// breakdown, and duration. Never a reservation id, user id, prompt,
// generated content, or JWT. Safe to ship to Cloudflare's request logs
// regardless of which trigger (HTTP or scheduled) produced it.
function logReconcileRun(fields: {
  trigger: "http" | "scheduled";
  result: "ok" | "error" | "rejected_concurrent" | "rejected_rate_limited";
  summary?: Omit<ReconciliationSummary, "errorMessage">;
  errorMessage?: string;
}) {
  console.log(JSON.stringify({ scope: "credit_reconcile_run", ...fields }));
}

export function clampBatchLimit(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_BATCH_LIMIT;
  return Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(requested)));
}

// Module-level, per-isolate only — NOT a distributed lock or rate limit.
// Cloudflare can and does run multiple isolates concurrently, each with
// its own copy of this state, so this does not guarantee a single global
// invocation the way a KV/Durable-Object-backed limiter would. It is
// still a real, honest defense against the most likely abuse pattern
// within a warm isolate (a misconfigured scheduler retrying rapidly, a
// script looping by mistake) at zero added infrastructure — and the
// underlying RPC is already safe under genuine cross-isolate concurrency
// regardless (proven via real Promise.all tests against the live
// database), so this is a resource-conservation measure, not a
// correctness requirement.
let runningPromise: Promise<ReconciliationSummary> | null = null;
let lastCompletedAt = 0;
const MIN_INTERVAL_MS = 5_000;

export async function runReconciliation(
  supabase: SupabaseClient<Database>,
  requestedBatchLimit: number | undefined,
  trigger: "http" | "scheduled",
): Promise<ReconciliationSummary> {
  if (runningPromise) {
    logReconcileRun({ trigger, result: "rejected_concurrent" });
    throw new ReconcileRejected("concurrent");
  }
  const sinceLast = Date.now() - lastCompletedAt;
  if (lastCompletedAt !== 0 && sinceLast < MIN_INTERVAL_MS) {
    logReconcileRun({ trigger, result: "rejected_rate_limited" });
    throw new ReconcileRejected("rate_limited");
  }

  const batchLimit = clampBatchLimit(requestedBatchLimit);
  const startedAt = Date.now();

  runningPromise = (async (): Promise<ReconciliationSummary> => {
    try {
      const { data, error } = await supabase.rpc("reconcile_stale_reservations_v2", {
        p_batch_limit: batchLimit,
      });
      const durationMs = Date.now() - startedAt;

      if (error) {
        const summary: ReconciliationSummary = {
          ok: false,
          batchLimit,
          inspected: 0,
          consumed: 0,
          refunded: 0,
          reservedNoEvidence: 0,
          inconsistent: 0,
          durationMs,
          errorMessage: error.message,
        };
        logReconcileRun({ trigger, result: "error", errorMessage: error.message });
        return summary;
      }

      const rows = data ?? [];
      const consumed = rows.filter((r) => r.outcome === "consumed").length;
      const refunded = rows.filter((r) => r.outcome === "refunded").length;
      // Rows the RPC deliberately left untouched (still 'reserved', no
      // evidence, under threshold) never appear in its result set at
      // all — "reservedNoEvidence"/"inconsistent" here can only ever be
      // 0 with the current RPC contract (v2 has no distinct "flagged"
      // outcome, everything not consumed/refunded is simply absent from
      // the returned rows). Kept as explicit fields rather than omitted
      // so a future RPC version that does report them doesn't require
      // an unrelated shape change here.
      const summary: ReconciliationSummary = {
        ok: true,
        batchLimit,
        inspected: rows.length,
        consumed,
        refunded,
        reservedNoEvidence: 0,
        inconsistent: 0,
        durationMs,
      };
      logReconcileRun({ trigger, result: "ok", summary });
      return summary;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logReconcileRun({ trigger, result: "error", errorMessage });
      return {
        ok: false,
        batchLimit,
        inspected: 0,
        consumed: 0,
        refunded: 0,
        reservedNoEvidence: 0,
        inconsistent: 0,
        durationMs,
        errorMessage,
      };
    } finally {
      lastCompletedAt = Date.now();
      runningPromise = null;
    }
  })();

  return runningPromise;
}

export class ReconcileRejected extends Error {
  constructor(public readonly reason: "concurrent" | "rate_limited") {
    super(`Reconciliation rejected: ${reason}`);
  }
}
