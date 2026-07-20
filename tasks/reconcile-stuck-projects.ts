import { defineTask } from "nitro/task";
import { createClient } from "@supabase/supabase-js";
import {
  runStuckProjectReconciliation,
  ReconcileRejected,
} from "@/lib/ai/reconcile-stuck-projects.server";
import type { Database } from "@/integrations/supabase/types";

// Sibling to tasks/reconcile-credits.ts — same Nitro Task mechanism, same
// dual-callable shape (a real Cloudflare Cron Trigger via runCronTasks(), or
// the internal HTTP endpoint below), same "no Cron Trigger registered
// anywhere today" caveat. See that file's header comment for the mechanism
// details and docs/build-with-ai-stuck-project-incident.md for why this
// task exists.
export default defineTask({
  meta: {
    name: "reconcile-stuck-projects",
    description:
      "Fail 'planning' AI projects stuck past a timeout via reconcile_stuck_ai_project_planning",
  },
  run: async ({ payload }) => {
    const trigger = payload?.triggerSource === "http" ? "http" : "scheduled";
    const timeoutMinutes =
      typeof payload?.timeoutMinutes === "number" ? payload.timeoutMinutes : undefined;
    const batchLimit = typeof payload?.batchLimit === "number" ? payload.batchLimit : undefined;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.log(
        JSON.stringify({
          scope: "stuck_project_reconcile_run",
          trigger,
          result: "rejected_config",
        }),
      );
      return { result: { ok: false, errorMessage: "not_configured" } };
    }

    const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    try {
      const summary = await runStuckProjectReconciliation(
        supabase,
        timeoutMinutes,
        batchLimit,
        trigger,
      );
      return { result: summary };
    } catch (err) {
      if (err instanceof ReconcileRejected) {
        return { result: { ok: false, errorMessage: err.reason } };
      }
      throw err;
    }
  },
});
