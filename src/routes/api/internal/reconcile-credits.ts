import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Internal endpoint invoking reconcile_stale_reservations_v2 (from
// supabase/migrations/20260728000000_reservation_job_evidence.sql, applied
// to ccpejnklrfvgtwryqfrw). Secrets (RECONCILE_SECRET,
// SUPABASE_SERVICE_ROLE_KEY) are configured on the preview Worker only —
// deployed to lostykk-postulpro-preview, deliberately NOT deployed to
// production.
//
// Not wired to any Cloudflare Cron Trigger — no `[triggers] crons = [...]`
// exists in wrangler.jsonc, and none should be added without separate
// authorization. This only runs when something calls it — today that
// means a manual, controlled invocation; an external scheduler pointed at
// this URL with the secret is a separate, not-yet-made decision.
//
// No client-supplied user_id or filter of any kind — the request body only
// controls the batch size (clamped), everything else is decided entirely
// server-side by the RPC itself.

const MAX_BATCH_LIMIT = 500;
const DEFAULT_BATCH_LIMIT = 200;

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

function methodNotAllowed() {
  return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
}

async function handlePost({ request }: { request: Request }) {
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

  // service_role client — never derived from a caller's session, and this
  // route never accepts or forwards a client-supplied user_id, so there is
  // no way for a caller to target an arbitrary user's reservation through
  // this endpoint even with a valid secret.
  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  try {
    const { data, error } = await supabase.rpc("reconcile_stale_reservations_v2", {
      p_batch_limit: batchLimit,
    });

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
}

export const Route = createFileRoute("/api/internal/reconcile-credits")({
  server: {
    handlers: {
      POST: handlePost,
      // Explicit rejection for every other verb — without these, TanStack
      // Start falls through to normal SSR page rendering for a path with
      // no handler registered for that method (a 200 with the app shell,
      // not a 404/405), which fails the "método incorrecto → 405"
      // requirement silently. Confirmed live before adding these: GET and
      // PUT both returned 200.
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
    },
  },
});

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
