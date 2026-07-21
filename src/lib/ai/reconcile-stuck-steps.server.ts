import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Shared reconciliation runner for ai_project_steps stuck in 'running' —
// the ONLY place that invokes reconcile_stuck_ai_project_steps (SQL logic
// in supabase/migrations/20260802030000_fix_step_completion_and_reconcile_stuck_steps.sql,
// column-ambiguity fix in 20260802040000). See
// docs/build-with-ai-stuck-project-incident.md for the real incident this
// closes (a business-plan step killed mid-generation, project falsely
// marked 'completed' at 75% progress).
//
// Deliberately does NOT touch credits — reconcile_stale_reservations_v2
// (lib/ai/reconcile-credits.server.ts) already owns that side via the same
// per-tool age thresholds; this only fixes ai_project_steps/ai_projects.
//
// Mirrors reconcile-stuck-projects.server.ts's shape exactly — same
// per-isolate concurrency/rate-limit guard, same trigger-agnostic runner.

const MAX_BATCH_LIMIT = 500;
const DEFAULT_BATCH_LIMIT = 200;

export type StuckStepsReconciliationSummary = {
  ok: boolean;
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
  // Structured, secret-free observability — only counts and outcome, never
  // a step id, project id, user id, or generated content.
  console.log(JSON.stringify({ scope: "stuck_step_reconcile_run", ...fields }));
}

export function clampBatchLimit(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_BATCH_LIMIT;
  return Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(requested)));
}

let runningPromise: Promise<StuckStepsReconciliationSummary> | null = null;
let lastCompletedAt = 0;
const MIN_INTERVAL_MS = 5_000;

export class ReconcileRejected extends Error {
  constructor(public readonly reason: "concurrent" | "rate_limited") {
    super(`Reconciliation rejected: ${reason}`);
  }
}

export async function runStuckStepReconciliation(
  supabase: SupabaseClient<Database>,
  requestedBatchLimit: number | undefined,
  trigger: "http" | "scheduled",
): Promise<StuckStepsReconciliationSummary> {
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

  runningPromise = (async (): Promise<StuckStepsReconciliationSummary> => {
    try {
      const { data, error } = await supabase.rpc("reconcile_stuck_ai_project_steps", {
        p_batch_limit: batchLimit,
      });

      if (error) {
        logReconcileRun({ trigger, result: "error", errorMessage: error.message });
        return { ok: false, batchLimit, failedCount: 0, errorMessage: error.message };
      }

      const failedCount = (data ?? []).length;
      logReconcileRun({ trigger, result: "ok", failedCount });
      return { ok: true, batchLimit, failedCount };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logReconcileRun({ trigger, result: "error", errorMessage });
      return { ok: false, batchLimit, failedCount: 0, errorMessage };
    } finally {
      lastCompletedAt = Date.now();
      runningPromise = null;
    }
  })();

  return runningPromise;
}
