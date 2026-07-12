import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";

// POST /api/projects/:id/steps/:stepId/skip — skip a step without
// charging credits. Ownership/status enforced entirely by the RPC.

export const Route = createFileRoute("/api/projects/$id/steps/$stepId/skip")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase } = ctx;

        const { error } = await supabase.rpc("skip_ai_project_step", { p_step_id: params.stepId });
        if (error) return json({ error: "No se pudo saltar este paso.", code: "invalid_state" }, 409);
        return json({ ok: true });
      },
    },
  },
});
