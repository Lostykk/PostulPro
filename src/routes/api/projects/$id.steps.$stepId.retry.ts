import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx } from "@/lib/api-auth.server";
import { runProjectStep } from "@/lib/projects/executor.server";

// POST /api/projects/:id/steps/:stepId/retry — explicit retry of a failed
// step. claim_ai_project_step already accepts 'failed' as a claimable
// status, so this is the same executor as /run — kept as its own route
// for a clear, spec'd contract and clearer client-side intent.

export const Route = createFileRoute("/api/projects/$id/steps/$stepId/retry")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        return runProjectStep(ctx.supabase, ctx.userId, params.id, params.stepId);
      },
    },
  },
});
