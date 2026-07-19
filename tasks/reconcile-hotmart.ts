import { defineTask } from "nitro/task";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Nitro Task for commercial (Hotmart) reconciliation — Fase I. Registered
// exactly like tasks/reconcile-credits.ts (same experimental.tasks
// mechanism, see that file's header comment for the full mechanism
// citation), but deliberately NOT added to vite.config.ts's
// `scheduledTasks` map — this task exists and is invocable via
// runTask("reconcile-hotmart", ...) for manual/preview testing, but no
// Cron Trigger is registered for it in any environment. Activating it in
// production is a separate, later, explicitly authorized step (mirroring
// exactly how the credit reconciler's own cron activation was staged in
// docs/premium-redesign-report.md).
//
// Deliberately its own task, not folded into "reconcile-credits": the
// two reconcile completely different domains (AI-generation credit
// reservations vs. Hotmart commercial subscriptions) against completely
// different tables, and mixing them would make each harder to reason
// about, test, and — critically — activate independently later.
export default defineTask({
  meta: {
    name: "reconcile-hotmart",
    description: "Reconcile stale Hotmart subscriptions/events via reconcile_hotmart_stale",
  },
  run: async ({ payload }) => {
    const batchLimit = typeof payload?.batchLimit === "number" ? payload.batchLimit : 200;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.log(JSON.stringify({ scope: "hotmart_reconcile_run", result: "rejected_config" }));
      return { result: { ok: false, errorMessage: "not_configured" } };
    }

    const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    const { data, error } = await supabase.rpc("reconcile_hotmart_stale", { p_batch_limit: batchLimit });
    if (error) {
      console.log(JSON.stringify({ scope: "hotmart_reconcile_run", result: "error", error: error.message }));
      return { result: { ok: false, errorMessage: error.message } };
    }
    const summary = data?.[0] ?? { expired_subscriptions: 0, stuck_events_flagged: 0 };
    console.log(JSON.stringify({ scope: "hotmart_reconcile_run", result: "ok", summary }));
    return { result: { ok: true, ...summary } };
  },
});
