import { defineTask } from "nitro/task";
import { createClient } from "@supabase/supabase-js";
import { runReconciliation, ReconcileRejected } from "@/lib/ai/reconcile-credits.server";
import type { Database } from "@/integrations/supabase/types";

// Official Nitro Task (nitro/docs/tasks — experimental but first-class,
// with native Cloudflare Cron Trigger integration for the cloudflare-
// module preset this project uses: enabling `experimental.tasks` makes
// Nitro's own generated scheduled() handler call runCronTasks(), which
// dispatches to whatever task names are mapped in `scheduledTasks` — see
// node_modules/nitro/dist/_build/common.mjs and
// node_modules/nitro/dist/presets/cloudflare/runtime/_module-handler.mjs
// for the exact mechanism, read and confirmed line-by-line before relying
// on it. This is genuinely built-in, not a hand-rolled hook or a
// server/plugins/ auto-discovery guess (that path was tried in an earlier
// round and reverted after confirming it doesn't bundle in this project).
//
// No SQL/business logic duplicated here — this is a thin adapter calling
// the exact same runReconciliation() the internal HTTP endpoint already
// uses (lib/ai/reconcile-credits.server.ts), which itself only ever calls
// reconcile_stale_reservations_v2. Whether this task ever actually runs
// on a schedule depends entirely on whether a Cron Trigger is registered
// for this Worker in wrangler config — see docs/premium-redesign-report.md
// for why none is registered on any environment today, and exactly what
// to add during cutover.
// Callable from two real paths, both exercised live before this task was
// considered validated:
//   - runCronTasks() (Cloudflare Cron Trigger -> scheduled() -> this task,
//     with no payload — trigger defaults to "scheduled")
//   - the internal HTTP endpoint (routes/api/internal/reconcile-credits.ts),
//     via runTask("reconcile-credits", { payload: { batchLimit,
//     triggerSource: "http" } }) — proves the exact same task-dispatch
//     mechanism a real Cron Trigger would use, through the already-
//     secret-gated, already-tested HTTP channel, without needing an
//     actual Cron Trigger configured anywhere.
export default defineTask({
  meta: {
    name: "reconcile-credits",
    description: "Reconcile stale credit_reservations via reconcile_stale_reservations_v2",
  },
  run: async ({ payload }) => {
    const trigger = payload?.triggerSource === "http" ? "http" : "scheduled";
    const batchLimit = typeof payload?.batchLimit === "number" ? payload.batchLimit : undefined;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.log(JSON.stringify({ scope: "credit_reconcile_run", trigger, result: "rejected_config" }));
      return { result: { ok: false, errorMessage: "not_configured" } };
    }

    const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });

    try {
      const summary = await runReconciliation(supabase, batchLimit, trigger);
      return { result: summary };
    } catch (err) {
      // ReconcileRejected (concurrent/rate-limited) is an expected,
      // already-logged outcome from the shared guard, not a task failure.
      if (err instanceof ReconcileRejected) {
        return { result: { ok: false, errorMessage: err.reason } };
      }
      throw err;
    }
  },
});
