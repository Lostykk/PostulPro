import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx } from "@/lib/api-auth.server";
import { runProjectStep } from "@/lib/projects/executor.server";

// POST /api/projects/:id/steps/:stepId/run — explicit single-step
// execution for "guided" mode (the user approves/edits each step before
// it runs). Same executor as run-next.

export const Route = createFileRoute("/api/projects/$id/steps/$stepId/run")({
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
