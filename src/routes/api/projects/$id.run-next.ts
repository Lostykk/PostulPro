import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import { resolveNextStepId, runProjectStep } from "@/lib/projects/executor.server";

// POST /api/projects/:id/run-next — resolves whichever step should run
// next (current_step_id, or the lowest-position pending/ready one) and
// executes it through the same claim/reserve/stream/persist path as the
// explicit steps/:stepId/run endpoint. Used by "automatic" mode to
// advance one step per request — the client just keeps calling this until
// the project is completed/paused/failed, never a server-side loop.

export const Route = createFileRoute("/api/projects/$id/run-next")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const stepId = await resolveNextStepId(supabase, params.id);
        if (!stepId)
          return json({ error: "No queda ningún paso pendiente.", code: "no_next_step" }, 409);

        return runProjectStep(supabase, userId, params.id, stepId, new URL(request.url).origin);
      },
    },
  },
});
