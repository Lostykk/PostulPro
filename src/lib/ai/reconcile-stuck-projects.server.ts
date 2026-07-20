import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Shared reconciliation runner for projects stuck in 'planning' — the ONLY
// place that invokes reconcile_stuck_ai_project_planning (SQL logic lives
// entirely in supabase/migrations/20260802020000_reconcile_stuck_ai_project_planning.sql).
// See docs/build-with-ai-stuck-project-incident.md for why this exists as a
// safety net alongside (not instead of) the route-level fix.
//
// Mirrors lib/ai/reconcile-credits.server.ts's shape exactly — same
// per-isolate concurrency/rate-limit guard, same trigger-agnostic runner
// callable from both the internal HTTP endpoint and a real Nitro Task.

const MAX_TIMEOUT_MINUTES = 24 * 60;
const DEFAULT_TIMEOUT_MINUTES = 15;
const MAX_BATCH_LIMIT = 500;
const DEFAULT_BATCH_LIMIT = 200;

export type StuckProjectsReconciliationSummary = {
  ok: boolean;
  timeoutMinutes: number;
  batchLimit: number;
  failedCount: number;
  errorMessage?: string;
};

function logReconcileRun(fields: {
  trigger: "http" | "scheduled";
  result: "ok" | "error" | "rejected_concurrent" | "rejected_rate_limited";
  failedCount?: number;
  errorMessage?: string;
}) {
  // Structured, secret-free observability — only counts and outcome, never a
  // project id, user id, idea text, or JWT.
  console.log(JSON.stringify({ scope: "stuck_project_reconcile_run", ...fields }));
}

export function clampTimeoutMinutes(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_TIMEOUT_MINUTES;
  return Math.max(1, Math.min(MAX_TIMEOUT_MINUTES, Math.floor(requested)));
}

export function clampBatchLimit(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_BATCH_LIMIT;
  return Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(requested)));
}

// Module-level, per-isolate only — same honest caveat as
// reconcile-credits.server.ts's identical guard: not a distributed lock,
// just cheap protection against a misconfigured scheduler retrying rapidly
// within one warm isolate.
let runningPromise: Promise<StuckProjectsReconciliationSummary> | null = null;
let lastCompletedAt = 0;
const MIN_INTERVAL_MS = 5_000;

export class ReconcileRejected extends Error {
  constructor(public readonly reason: "concurrent" | "rate_limited") {
    super(`Reconciliation rejected: ${reason}`);
  }
}

export async function runStuckProjectReconciliation(
  supabase: SupabaseClient<Database>,
  requestedTimeoutMinutes: number | undefined,
  requestedBatchLimit: number | undefined,
  trigger: "http" | "scheduled",
): Promise<StuckProjectsReconciliationSummary> {
  if (runningPromise) {
    logReconcileRun({ trigger, result: "rejected_concurrent" });
    throw new ReconcileRejected("concurrent");
  }
  const sinceLast = Date.now() - lastCompletedAt;
  if (lastCompletedAt !== 0 && sinceLast < MIN_INTERVAL_MS) {
    logReconcileRun({ trigger, result: "rejected_rate_limited" });
    throw new ReconcileRejected("rate_limited");
  }

  const timeoutMinutes = clampTimeoutMinutes(requestedTimeoutMinutes);
  const batchLimit = clampBatchLimit(requestedBatchLimit);

  runningPromise = (async (): Promise<StuckProjectsReconciliationSummary> => {
    try {
      const { data, error } = await supabase.rpc("reconcile_stuck_ai_project_planning", {
        p_timeout_minutes: timeoutMinutes,
        p_batch_limit: batchLimit,
      });

      if (error) {
        logReconcileRun({ trigger, result: "error", errorMessage: error.message });
        return {
          ok: false,
          timeoutMinutes,
          batchLimit,
          failedCount: 0,
          errorMessage: error.message,
        };
      }

      const failedCount = (data ?? []).length;
      logReconcileRun({ trigger, result: "ok", failedCount });
      return { ok: true, timeoutMinutes, batchLimit, failedCount };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logReconcileRun({ trigger, result: "error", errorMessage });
      return { ok: false, timeoutMinutes, batchLimit, failedCount: 0, errorMessage };
    } finally {
      lastCompletedAt = Date.now();
      runningPromise = null;
    }
  })();

  return runningPromise;
}
