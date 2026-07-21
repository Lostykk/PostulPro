import { defineTask } from "nitro/task";
import { createClient } from "@supabase/supabase-js";
import {
  runStuckStepReconciliation,
  ReconcileRejected,
} from "@/lib/ai/reconcile-stuck-steps.server";
import type { Database } from "@/integrations/supabase/types";

// Sibling to tasks/reconcile-stuck-projects.ts — same Nitro Task mechanism.
// See docs/build-with-ai-stuck-project-incident.md.
export default defineTask({
  meta: {
    name: "reconcile-stuck-steps",
    description:
      "Fail 'running' project steps stuck past their per-tool timeout via reconcile_stuck_ai_project_steps",
  },
  run: async ({ payload }) => {
    const trigger = payload?.triggerSource === "http" ? "http" : "scheduled";
    const batchLimit = typeof payload?.batchLimit === "number" ? payload.batchLimit : undefined;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.log(
        JSON.stringify({ scope: "stuck_step_reconcile_run", trigger, result: "rejected_config" }),
      );
      return { result: { ok: false, errorMessage: "not_configured" } };
    }

    const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    try {
      const summary = await runStuckStepReconciliation(supabase, batchLimit, trigger);
      return { result: summary };
    } catch (err) {
      if (err instanceof ReconcileRejected) {
        return { result: { ok: false, errorMessage: err.reason } };
      }
      throw err;
    }
  },
});
