import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { runTask } from "nitro/task";
import type { StuckProjectsReconciliationSummary } from "@/lib/ai/reconcile-stuck-projects.server";

// Internal endpoint dispatching to the "reconcile-stuck-projects" Nitro Task
// — sibling to routes/api/internal/reconcile-credits.ts, same secret
// (RECONCILE_SECRET, already configured on the preview Worker), same
// not-wired-to-any-Cloudflare-Cron-Trigger caveat. See
// docs/build-with-ai-stuck-project-incident.md.

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
    return json({ error: "Not configured" }, 501);
  }

  const provided = request.headers.get("x-reconcile-secret");
  if (!secretMatches(provided, RECONCILE_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let timeoutMinutes: number | undefined;
  let batchLimit: number | undefined;
  try {
    const body = (await request.json()) as { timeoutMinutes?: number; batchLimit?: number } | null;
    if (typeof body?.timeoutMinutes === "number") timeoutMinutes = body.timeoutMinutes;
    if (typeof body?.batchLimit === "number") batchLimit = body.batchLimit;
  } catch {
    /* no body / invalid JSON — the runner falls back to its own defaults */
  }

  try {
    const { result } = await runTask("reconcile-stuck-projects", {
      payload: { timeoutMinutes, batchLimit, triggerSource: "http" },
    });
    const summary = result as StuckProjectsReconciliationSummary;
    if (!summary.ok) {
      if (summary.errorMessage === "concurrent" || summary.errorMessage === "rate_limited") {
        return json(
          {
            error: "Reconciliation already in progress or called too soon",
            reason: summary.errorMessage,
          },
          429,
          { "Retry-After": "5" },
        );
      }
      return json({ error: "Reconciliation failed" }, 500);
    }
    return json(summary);
  } catch {
    return json({ error: "Reconciliation failed" }, 500);
  }
}

export const Route = createFileRoute("/api/internal/reconcile-stuck-projects")({
  server: {
    handlers: {
      POST: handlePost,
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
