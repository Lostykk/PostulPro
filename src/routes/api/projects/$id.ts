import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";

// GET /api/projects/:id — full project detail + its steps (RLS-scoped, so
// this can never return another user's project/steps regardless of what
// id is requested).

export const Route = createFileRoute("/api/projects/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const { data: project, error } = await supabase
          .from("ai_projects")
          .select("*")
          .eq("id", params.id)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) return json({ error: "No se pudo cargar el proyecto." }, 500);
        if (!project) return json({ error: "Proyecto no encontrado." }, 404);

        const { data: steps } = await supabase
          .from("ai_project_steps")
          .select("id,position,tool_key,title,description,status,credits_cost,attempts,error_code,error_message_safe,output_generation_id,started_at,completed_at")
          .eq("project_id", params.id)
          .order("position", { ascending: true });

        return json({ project, steps: steps ?? [] });
      },
    },
  },
});
