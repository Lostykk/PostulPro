import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import { generateProjectPlan, PlannerError } from "@/lib/projects/planner.server";
import { isProjectCapability, realCreditsFor } from "@/lib/projects/capabilities.server";
import { PlanDeliverableSchema, MAX_DELIVERABLES } from "@/lib/projects/schema";
import { claimPlanRateLimit, rateLimitHeaders } from "@/lib/rate-limit.server";
import { checkAiExecutionAllowed, isPreviewEnvironment } from "@/lib/ai/preview-guard.server";
import { isOwner } from "@/lib/auth/is-owner";
import { canRetryPlanning } from "@/lib/projects/planning-gate";
import { z } from "zod";

// POST  /api/projects/:id/plan — run the planner against the project's
//       stored idea and persist the resulting brief + plan + steps.
// PATCH /api/projects/:id/plan — apply a user-edited deliverable list
//       (reordered/removed/added) to an existing plan. Every tool_key is
//       re-checked against the allowlist and every cost is recalculated
//       server-side — the client's numbers are never trusted, even for an
//       edit of a plan the server itself just generated.

const PatchPlanSchema = z.object({
  deliverables: z
    .array(PlanDeliverableSchema.omit({ estimatedCredits: true }))
    .min(1)
    .max(MAX_DELIVERABLES),
});

export const Route = createFileRoute("/api/projects/$id/plan")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }
        const parsed = PatchPlanSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { error: parsed.error.issues[0]?.message ?? "Plan inválido.", code: "invalid_input" },
            400,
          );
        }

        const invalidTool = parsed.data.deliverables.find((d) => !isProjectCapability(d.toolKey));
        if (invalidTool) {
          return json(
            { error: `"${invalidTool.toolKey}" no es una capacidad válida.`, code: "invalid_tool" },
            400,
          );
        }

        const { data: project } = await supabase
          .from("ai_projects")
          .select("title,project_type,brief_json,plan_json,assumptions_json")
          .eq("id", params.id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!project) return json({ error: "Proyecto no encontrado." }, 404);

        const deliverables = parsed.data.deliverables.map((d) => ({
          ...d,
          estimatedCredits: realCreditsFor(d.toolKey),
        }));
        const totalCredits = deliverables.reduce((sum, d) => sum + d.estimatedCredits, 0);
        const steps = deliverables.map((d, i) => ({
          position: i + 1,
          tool_key: d.toolKey,
          title: d.title,
          description: d.description,
          input: d.input,
          credits_cost: d.estimatedCredits,
        }));

        const updatedPlan = {
          ...(project.plan_json as Record<string, unknown>),
          deliverables,
          totalEstimatedCredits: totalCredits,
        };

        const { error } = await supabase.rpc("save_ai_project_plan", {
          p_project_id: params.id,
          p_title: project.title ?? "",
          p_project_type: project.project_type ?? "",
          p_brief_json: project.brief_json as never,
          p_plan_json: updatedPlan as never,
          p_assumptions_json: project.assumptions_json as never,
          p_total_credits: totalCredits,
          p_steps: steps as never,
        });
        if (error)
          return json(
            { error: error.message.slice(0, 200) || "No se pudo actualizar el plan." },
            400,
          );

        return json({ plan: updatedPlan });
      },

      POST: async ({ request, params }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const { data: project, error: loadErr } = await supabase
          .from("ai_projects")
          .select("id,status,original_idea,objective,target_audience,language,plan_json")
          .eq("id", params.id)
          .eq("user_id", userId)
          .maybeSingle();
        if (loadErr) return json({ error: "No se pudo cargar el proyecto." }, 500);
        if (!project) return json({ error: "Proyecto no encontrado." }, 404);
        // A project that failed during planning (no plan_json ever saved) is
        // retriable on this same id — that's the whole point of persisting a
        // real 'failed' state instead of leaving it stuck in 'planning'. A
        // project that failed later, during step execution (plan_json
        // exists, steps/credits already in play), is NOT retriable here —
        // regenerating the plan would silently wipe real progress; that case
        // goes through the step-level retry endpoints instead.
        if (!canRetryPlanning(project.status, Boolean(project.plan_json))) {
          return json(
            {
              error: `El proyecto no está en un estado planificable (${project.status}).`,
              code: "invalid_state",
            },
            409,
          );
        }

        // Preview-only allowlist gate — checked before rate limiting/credits
        // so a disallowed caller never even reaches those. Admins bypass the
        // single-QA-user restriction without replacing it. The role lookup
        // only runs in preview, so production pays zero extra cost.
        let isAdminForGuard = false;
        if (isPreviewEnvironment()) {
          const { data: guardProfile } = await supabase
            .from("users")
            .select("role")
            .eq("id", userId)
            .maybeSingle();
          isAdminForGuard = isOwner(guardProfile);
        }
        const guard = checkAiExecutionAllowed(userId, isAdminForGuard);
        if (!guard.allowed) {
          return json({ error: guard.message, code: guard.code }, guard.status);
        }

        // Rate limit BEFORE calling the model — a rejected request never
        // reaches the planner, so it can't cost anything or spend credits.
        let rate;
        try {
          rate = await claimPlanRateLimit(supabase, request);
        } catch {
          return json(
            {
              error: "No se pudo verificar el límite de solicitudes. Probá de nuevo en un momento.",
            },
            503,
          );
        }
        if (!rate.allowed) {
          return json(
            {
              error:
                "Alcanzaste el límite de planes que podés generar por ahora. Probá de nuevo más tarde.",
              code: "rate_limited",
            },
            429,
            rateLimitHeaders(rate),
          );
        }

        const { data: profile } = await supabase
          .from("users")
          .select("plan,primary_goal,company_name,role")
          .eq("id", userId)
          .maybeSingle();

        let result;
        try {
          result = await generateProjectPlan({
            idea: project.original_idea,
            objective: project.objective ?? undefined,
            targetAudience: project.target_audience ?? undefined,
            language: project.language,
            plan: (profile?.plan as "free" | "pro" | "business") ?? "free",
            isOwner: isOwner(profile),
            userContext: { primaryGoal: profile?.primary_goal, companyName: profile?.company_name },
          });
        } catch (err) {
          // Persist the failure so the project is a real, revisitable
          // "failed" state instead of staying stuck in "planning" forever
          // with no plan/steps and no way to tell "still running" apart
          // from "silently died". Best-effort: if this write itself fails,
          // the original planner error still reaches the client below.
          const errorCode = err instanceof PlannerError ? err.code : "unknown_error";
          await supabase
            .rpc("fail_ai_project_planning", { p_project_id: params.id, p_error_code: errorCode })
            .then(
              () => {},
              () => {},
            );

          if (err instanceof PlannerError) {
            return json(
              { error: err.message, code: err.code },
              err.code === "provider_error" ? 502 : 422,
            );
          }
          return json({ error: "No se pudo generar el plan." }, 500);
        }

        const steps = result.plan.deliverables.map((d, i) => ({
          position: i + 1,
          tool_key: d.toolKey,
          title: d.title,
          description: d.description,
          input: d.input,
          credits_cost: d.estimatedCredits,
        }));
        const { error: saveErr } = await supabase.rpc("save_ai_project_plan", {
          p_project_id: params.id,
          p_title: result.plan.title,
          p_project_type: result.plan.projectType,
          p_brief_json: result.brief as never,
          p_plan_json: result.plan as never,
          p_assumptions_json: {
            assumptions: result.plan.assumptions,
            questionsOrWarnings: result.plan.questionsOrWarnings,
          } as never,
          p_total_credits: result.plan.totalEstimatedCredits,
          p_steps: steps as never,
        });
        if (saveErr) {
          // The plan itself was generated and validated successfully — only
          // the DB write failed. Credits were never touched by planning in
          // the first place (only step execution charges credits), so this
          // is honestly communicated as a save failure, not a billing one.
          // Safe to retry: save_ai_project_plan replaces (not appends)
          // this project's steps, so re-submitting never duplicates them.
          console.log(
            JSON.stringify({
              scope: "ai_planner_persist",
              code: "persistence_failed",
              projectId: params.id,
            }),
          );
          await supabase
            .rpc("fail_ai_project_planning", {
              p_project_id: params.id,
              p_error_code: "persistence_failed",
            })
            .then(
              () => {},
              () => {},
            );
          return json(
            {
              error: "No pudimos terminar el diseño del proyecto. Tu saldo no fue afectado.",
              code: "persistence_failed",
            },
            502,
          );
        }

        return json({ brief: result.brief, plan: result.plan });
      },
    },
  },
});
