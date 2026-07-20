import { defineTask } from "nitro/task";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runHotmartReconciliation } from "@/lib/hotmart/reconcile-hotmart.server";

// Nitro Task for commercial (Hotmart) reconciliation. Thin adapter only —
// all real logic lives in reconcile-hotmart.server.ts's
// runHotmartReconciliation (see that module's header comment for the full
// Fase 5 autonomous-recovery design), the same "no logic duplicated in the
// task layer" convention tasks/reconcile-credits.ts already follows.
//
// Registered in vite.config.ts's scheduledTasks alongside reconcile-credits
// (same */5 cron cadence — no new Cron Trigger, no new infrastructure).
export default defineTask({
  meta: {
    name: "reconcile-hotmart",
    description: "Reconcile stale Hotmart subscriptions/events and auto-retry recoverable failures",
  },
  run: async ({ payload }) => {
    const batchLimit = typeof payload?.batchLimit === "number" ? payload.batchLimit : 200;
    const retryBatchLimit = typeof payload?.retryBatchLimit === "number" ? payload.retryBatchLimit : 25;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const billingRpcSecret = process.env.BILLING_RPC_SECRET;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !billingRpcSecret) {
      console.log(JSON.stringify({ scope: "hotmart_reconcile_run", result: "rejected_config" }));
      return { result: { ok: false, errorMessage: "not_configured" } };
    }

    const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    const outcome = await runHotmartReconciliation(supabase, billingRpcSecret, batchLimit, retryBatchLimit);
    if (!outcome.ok) {
      return { result: { ok: false, errorMessage: outcome.errorMessage } };
    }
    return { result: { ok: true, ...outcome.summary } };
  },
});
