import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import { CreateProjectInputSchema } from "@/lib/projects/schema";

// GET  /api/projects        — list the caller's projects (RLS-scoped)
// POST /api/projects        — create a draft project from a free-text idea

export const Route = createFileRoute("/api/projects/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const url = new URL(request.url);
        const status = url.searchParams.get("status");

        let query = supabase
          .from("ai_projects")
          .select(
            "id,title,original_idea,project_type,status,execution_mode,estimated_credits,spent_credits,progress_percent,created_at,updated_at,completed_at,archived_at",
          )
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(100);

        if (status === "active") query = query.in("status", ["draft", "planning", "awaiting_confirmation", "ready", "running", "paused"]);
        else if (status === "completed") query = query.eq("status", "completed");
        else if (status === "draft") query = query.in("status", ["draft", "planning", "awaiting_confirmation"]);
        else if (status === "archived") query = query.eq("status", "archived");

        const { data, error } = await query;
        if (error) return json({ error: "No se pudieron cargar los proyectos." }, 500);
        return json({ projects: data ?? [] });
      },

      POST: async ({ request }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase } = ctx;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const parsed = CreateProjectInputSchema.safeParse(body);
        if (!parsed.success) {
          return json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos", code: "invalid_input" }, 400);
        }

        const { data: projectId, error } = await supabase.rpc("create_ai_project", {
          p_original_idea: parsed.data.idea,
          p_objective: parsed.data.objective ?? undefined,
          p_target_audience: parsed.data.targetAudience ?? undefined,
          p_language: parsed.data.language,
          p_execution_mode: parsed.data.executionMode,
        });

        if (error) return json({ error: error.message.slice(0, 200) || "No se pudo crear el proyecto." }, 400);
        return json({ id: projectId }, 201);
      },
    },
  },
});
