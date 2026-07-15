import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getTool } from "@/lib/ai/tools-config.server";
import { callModel, logModelUsage, type ModelUsage } from "@/lib/ai/call-model.server";
import { checkAiExecutionAllowed, isPreviewEnvironment } from "@/lib/ai/preview-guard.server";
import { maybeSendLowCreditsEmail } from "@/lib/notifications/low-credits.server";
import { buildStepPrompt } from "@/lib/projects/step-prompts.server";
import { getCapabilityMeta } from "@/lib/projects/capabilities.server";
import { ProjectBriefSchema } from "@/lib/projects/schema";
import { isOwner } from "@/lib/auth/is-owner";

// Runs exactly one project step end to end: claim -> reserve credits ->
// stream the model -> persist the generation -> mark the step complete
// (or refund + mark failed). This is the single code path used by both
// POST /api/projects/:id/steps/:stepId/run and POST /api/projects/:id/run-next
// so there is only one place that can charge credits for a step.
//
// Mirrors routes/api/generate-ai.ts's reserve-before-stream /
// refund-on-failure pattern exactly, just wrapped with step bookkeeping.

type Db = SupabaseClient<Database>;

const MAX_AUTO_ATTEMPTS = 3;

type ClaimRow = {
  claimed: boolean;
  reason: string;
  tool_key: string | null;
  input_json: Record<string, unknown> | null;
  credits_cost: number | null;
  brief_json: unknown;
  attempts: number | null;
};

const CLAIM_ERROR_STATUS: Record<string, number> = {
  project_not_found: 404,
  forbidden: 403,
  project_archived: 409,
  project_completed: 409,
  not_claimable: 409,
};

export async function runProjectStep(
  supabase: Db,
  userId: string,
  projectId: string,
  stepId: string,
  appOrigin?: string,
): Promise<Response> {
  // Preview-only allowlist gate — checked before the atomic claim so a
  // disallowed caller never puts a step into "claimed" state. Admins bypass
  // the single-QA-user restriction without replacing it. The extra role
  // lookup only runs in preview, so production pays zero cost for it — this
  // whole block is a no-op there, same as before.
  let isAdminForGuard = false;
  if (isPreviewEnvironment()) {
    const { data: guardProfile } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
    isAdminForGuard = isOwner(guardProfile);
  }
  const guard = checkAiExecutionAllowed(userId, isAdminForGuard);
  if (!guard.allowed) return json({ error: guard.message, code: guard.code }, guard.status);

  const { data: claimRows, error: claimErr } = await supabase.rpc("claim_ai_project_step", {
    p_project_id: projectId,
    p_step_id: stepId,
  });
  if (claimErr) {
    console.error(
      JSON.stringify({
        scope: "claim_ai_project_step",
        code: claimErr.code,
        message: claimErr.message,
        details: claimErr.details,
        hint: claimErr.hint,
      }),
    );
    return json({ error: "No se pudo iniciar el paso." }, 500);
  }
  const claim = (claimRows?.[0] as ClaimRow | undefined) ?? null;
  if (!claim || !claim.claimed) {
    const reason = claim?.reason ?? "unknown";
    return json(
      { error: describeClaimFailure(reason), code: reason },
      CLAIM_ERROR_STATUS[reason] ?? 409,
    );
  }

  const toolKey = claim.tool_key ?? "";
  const tool = getTool(toolKey);
  const capability = getCapabilityMeta(toolKey);
  if (!tool || !capability) {
    await supabase.rpc("fail_ai_project_step", {
      p_step_id: stepId,
      p_error_code: "invalid_tool",
      p_error_message_safe: "La capacidad seleccionada ya no está disponible.",
      p_pause_project: true,
    });
    return json(
      { error: "La capacidad seleccionada ya no está disponible.", code: "invalid_tool" },
      500,
    );
  }

  // Defense in depth: re-check the plan gate even though the planner
  // already filtered by plan, in case the user's plan changed between
  // planning and execution. Owners bypass this without a plan change.
  if (tool.planGate) {
    const { data: profile } = await supabase
      .from("users")
      .select("plan,role")
      .eq("id", userId)
      .maybeSingle();
    const rank: Record<string, number> = { free: 0, pro: 1, business: 2 };
    if (!isOwner(profile) && (rank[profile?.plan ?? "free"] ?? 0) < (rank[tool.planGate] ?? 0)) {
      await supabase.rpc("fail_ai_project_step", {
        p_step_id: stepId,
        p_error_code: "plan_required",
        p_error_message_safe: `Este paso requiere plan ${tool.planGate.toUpperCase()} o superior.`,
        p_pause_project: true,
      });
      return json(
        {
          error: `Este paso requiere plan ${tool.planGate.toUpperCase()} o superior.`,
          code: "plan_required",
        },
        403,
      );
    }
  }

  const cost = claim.credits_cost ?? tool.credits;
  const { data: reserveRows, error: reserveErr } = await supabase.rpc("reserve_credits", {
    p_cost: cost,
  });
  const reserve = reserveRows?.[0];
  if (reserveErr || !reserve || !reserve.ok) {
    await supabase.rpc("fail_ai_project_step", {
      p_step_id: stepId,
      p_error_code: "insufficient_credits",
      p_error_message_safe: "No hay créditos suficientes para este paso.",
      p_pause_project: true,
    });
    const remaining = reserve ? reserve.credits_limit - reserve.credits_used : 0;
    return json(
      {
        error: `Créditos insuficientes. Necesitás ${cost}, tenés ${remaining}.`,
        code: "insufficient_credits",
      },
      402,
    );
  }
  await supabase.rpc("mark_step_credits_reserved", { p_step_id: stepId });
  await maybeSendLowCreditsEmail(
    supabase,
    userId,
    cost,
    reserve.credits_used,
    reserve.credits_limit,
    appOrigin,
  );

  const briefParse = ProjectBriefSchema.safeParse(claim.brief_json ?? {});
  const brief = briefParse.success ? briefParse.data : ProjectBriefSchema.parse({});
  const prompt = buildStepPrompt(toolKey, brief, claim.input_json ?? {});

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let settled = false;

  const settleFailure = async (errorCode: string, safeMessage: string) => {
    if (settled) return;
    settled = true;
    try {
      await supabase.rpc("refund_credits", { p_cost: cost });
    } catch {
      /* best-effort */
    }
    try {
      await supabase.rpc("fail_ai_project_step", {
        p_step_id: stepId,
        p_error_code: errorCode,
        p_error_message_safe: safeMessage,
        p_pause_project: (claim.attempts ?? 1) >= MAX_AUTO_ATTEMPTS,
      });
    } catch {
      /* best-effort */
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };

      let full = "";
      let usage: ModelUsage = { inputTokens: null, outputTokens: null };
      const startedAt = Date.now();
      try {
        await callModel(
          tool,
          prompt,
          (delta) => {
            full += delta;
            send({ type: "delta", text: delta, stepId });
          },
          abortController.signal,
          (u) => (usage = u),
        );
        logModelUsage({
          provider: tool.provider,
          model: tool.model,
          operation: "project_step",
          toolKey,
          usage,
          durationMs: Date.now() - startedAt,
          status: "success",
        });

        const { data: gen } = await supabase
          .from("generations")
          .insert({
            user_id: userId,
            tool: toolKey,
            title: capability.name,
            output: full,
            prompt_json: { prompt } as never,
            tokens_used: usage.outputTokens ?? Math.ceil(full.length / 4),
            project_id: projectId,
            project_step_id: stepId,
            artifact_type: capability.deliverableType,
          })
          .select("id")
          .maybeSingle();

        if (!gen?.id) throw new Error("No se pudo guardar el resultado.");

        settled = true;
        await supabase.rpc("complete_ai_project_step", {
          p_step_id: stepId,
          p_generation_id: gen.id,
        });

        const { data: project } = await supabase
          .from("ai_projects")
          .select("status,progress_percent,spent_credits,current_step_id")
          .eq("id", projectId)
          .maybeSingle();
        const { data: refreshed } = await supabase
          .from("users")
          .select("credits_used,credits_limit")
          .eq("id", userId)
          .maybeSingle();

        send({
          type: "done",
          generationId: gen.id,
          stepId,
          projectStatus: project?.status ?? null,
          progressPercent: project?.progress_percent ?? null,
          currentStepId: project?.current_step_id ?? null,
          creditsRemaining: refreshed ? refreshed.credits_limit - refreshed.credits_used : null,
        });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "El modelo falló al generar este paso.";
        logModelUsage({
          provider: tool.provider,
          model: tool.model,
          operation: "project_step",
          toolKey,
          usage,
          durationMs: Date.now() - startedAt,
          status: "error",
          errorCode: "provider_error",
        });
        await settleFailure(
          "provider_error",
          "El modelo falló al generar este paso. Podés reintentarlo.",
        );
        send({ type: "error", message, stepId });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel(reason) {
      abortController.abort(reason);
      void settleFailure(
        "client_disconnected",
        "La conexión se interrumpió mientras se generaba este paso.",
      );
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Resolves the next runnable step (current_step_id, or the lowest-position
// pending/ready one) for run-next.
export async function resolveNextStepId(supabase: Db, projectId: string): Promise<string | null> {
  const { data: project } = await supabase
    .from("ai_projects")
    .select("current_step_id")
    .eq("id", projectId)
    .maybeSingle();
  if (project?.current_step_id) return project.current_step_id;

  const { data: step } = await supabase
    .from("ai_project_steps")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["pending", "ready"])
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return step?.id ?? null;
}

function describeClaimFailure(reason: string): string {
  switch (reason) {
    case "project_not_found":
      return "Proyecto no encontrado.";
    case "forbidden":
      return "No tenés acceso a este proyecto.";
    case "project_archived":
      return "Este proyecto está archivado.";
    case "project_completed":
      return "Este proyecto ya está completo.";
    case "not_claimable":
      return "Este paso ya se está ejecutando o ya terminó.";
    default:
      return "No se pudo iniciar el paso.";
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
