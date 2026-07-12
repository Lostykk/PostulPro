import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";

// POST /api/projects/:id/confirm — awaiting_confirmation -> ready.
// Rejects with 409 if the plan is stale (edited brief since last plan).

export const Route = createFileRoute("/api/projects/$id/confirm")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase } = ctx;

        const { error } = await supabase.rpc("confirm_ai_project_plan", { p_project_id: params.id });
        if (error) {
          const stale = error.message.toLowerCase().includes("stale");
          return json(
            { error: stale ? "El plan quedó desactualizado. Regeneralo antes de confirmar." : "No se pudo confirmar el plan.", code: stale ? "plan_stale" : "invalid_state" },
            409,
          );
        }
        return json({ ok: true });
      },
    },
  },
});
