import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";

export const Route = createFileRoute("/api/projects/$id/pause")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { error } = await ctx.supabase.rpc("pause_ai_project", { p_project_id: params.id });
        if (error) return json({ error: "No se pudo pausar el proyecto.", code: "invalid_state" }, 409);
        return json({ ok: true });
      },
    },
  },
});
