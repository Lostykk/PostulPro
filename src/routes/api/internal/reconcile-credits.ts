import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// INTERNAL, NOT YET ACTIVATED. Calls reconcile_stale_reservations_v2 (from
// supabase/migrations/20260728000000_reservation_job_evidence.sql), which
// is not yet applied to any database — every call to this endpoint will
// currently fail with "function does not exist" until that migration is
// separately authorized and applied, and this route is deployed after.
//
// Not wired to any Cloudflare Cron Trigger — no `[triggers] crons = [...]`
// exists in wrangler.jsonc, and none should be added without separate
// authorization (touches the Cloudflare project's trigger configuration,
// which this task's authorization explicitly excludes). Until that
// exists, this endpoint only runs when something calls it — a manual
// request, or an external scheduler (e.g. a scheduled GitHub Actions
// workflow, or a third-party cron ping service) pointed at this URL with
// the shared secret below.
//
// Requires two env vars neither currently set anywhere in this project:
//   RECONCILE_SECRET            — a long random string, Cloudflare secret
//                                  (`wrangler secret put`), never in wrangler.jsonc
//   SUPABASE_SERVICE_ROLE_KEY   — the project's service_role key, same way
//                                  (reconcile_stale_reservations_v2 is
//                                  service_role-only by design — it acts
//                                  across every user's reservations, which
//                                  no RLS-scoped `authenticated` call could
//                                  safely do)
// Until both are configured, this returns 501 rather than doing anything.
//
// No client-supplied user_id or filter of any kind — the request body only
// controls the batch size (clamped), everything else is decided entirely
// server-side by the RPC itself.

const MAX_BATCH_LIMIT = 500;
const DEFAULT_BATCH_LIMIT = 200;

type ReconcileRow = { reservation_id: string; outcome: string; evidence: string };

function logReconcileRun(fields: {
  result: "rejected_auth" | "rejected_config" | "ok" | "error";
  batchLimit?: number;
  consumed?: number;
  refunded?: number;
  errorMessage?: string;
}) {
  console.log(JSON.stringify({ scope: "credit_reconcile_run", ...fields }));
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/internal/reconcile-credits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const RECONCILE_SECRET = process.env.RECONCILE_SECRET;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!RECONCILE_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
          logReconcileRun({ result: "rejected_config" });
          return json({ error: "Not configured" }, 501);
        }

        const provided = request.headers.get("x-reconcile-secret");
        if (!secretMatches(provided, RECONCILE_SECRET)) {
          logReconcileRun({ result: "rejected_auth" });
          return json({ error: "Unauthorized" }, 401);
        }

        let batchLimit = DEFAULT_BATCH_LIMIT;
        try {
          const body = (await request.json()) as { batchLimit?: number } | null;
          if (typeof body?.batchLimit === "number" && Number.isFinite(body.batchLimit)) {
            batchLimit = Math.max(1, Math.min(MAX_BATCH_LIMIT, Math.floor(body.batchLimit)));
          }
        } catch {
          /* no body / invalid JSON — use the default batch size */
        }

        // service_role client — never derived from a caller's session, and
        // this route never accepts or forwards a client-supplied user_id,
        // so there is no way for a caller to target an arbitrary user's
        // reservation through this endpoint even with a valid secret.
        const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        try {
          // Cast: reconcile_stale_reservations_v2 isn't in the generated
          // Database types yet because its migration hasn't been applied
          // to any real database — remove this cast once it has been and
          // `supabase gen types` has been re-run.
          const { data, error } = await (
            supabase.rpc as unknown as (
              fn: "reconcile_stale_reservations_v2",
              args: { p_batch_limit: number },
            ) => Promise<{ data: ReconcileRow[] | null; error: { message: string } | null }>
          )("reconcile_stale_reservations_v2", { p_batch_limit: batchLimit });

          if (error) {
            logReconcileRun({ result: "error", batchLimit, errorMessage: error.message });
            return json({ error: "Reconciliation failed" }, 500);
          }

          const rows = data ?? [];
          const consumed = rows.filter((r) => r.outcome === "consumed").length;
          const refunded = rows.filter((r) => r.outcome === "refunded").length;
          logReconcileRun({ result: "ok", batchLimit, consumed, refunded });

          return json({ ok: true, batchLimit, touched: rows.length, consumed, refunded });
        } catch (err) {
          logReconcileRun({
            result: "error",
            batchLimit,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          return json({ error: "Reconciliation failed" }, 500);
        }
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
