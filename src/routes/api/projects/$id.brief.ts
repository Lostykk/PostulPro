import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import { ProjectBriefSchema } from "@/lib/projects/schema";

// PATCH /api/projects/:id/brief — edit the canonical brief. If anything
// structural changes, the RPC flags plan_stale so the UI must offer
// "Actualizar plan" instead of silently running against stale context.

export const Route = createFileRoute("/api/projects/$id/brief")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase } = ctx;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = ProjectBriefSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: parsed.error.issues[0]?.message ?? "Brief inválido.", code: "invalid_input" }, 400);
        }

        const { error } = await supabase.rpc("update_ai_project_brief", {
          p_project_id: params.id,
          p_brief_json: parsed.data as never,
        });
        if (error) return json({ error: error.message.slice(0, 200) || "No se pudo actualizar el brief." }, 400);

        return json({ ok: true });
      },
    },
  },
});
