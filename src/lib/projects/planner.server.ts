import { CLAUDE } from "@/lib/ai/tools-config.server";
import { callModelOnce, logModelUsage } from "@/lib/ai/call-model.server";
import {
  PLANNER_ALLOWLIST,
  listProjectCapabilities,
  realCreditsFor,
} from "@/lib/projects/capabilities.server";
import {
  ProjectBriefSchema,
  ProjectPlanSchema,
  type ProjectBrief,
  type ProjectPlan,
} from "@/lib/projects/schema";
import { z } from "zod";

// The server-side planner: turns a free-text idea into a structured,
// server-verified plan + brief. The model's own numbers (estimatedCredits,
// tool choice) are never trusted as-is — every deliverable is cross-checked
// against the real capability allowlist and every cost is recalculated
// from the real tool registry before this function returns.

export type PlannerErrorCode =
  | "empty_response"
  | "truncated_response"
  | "json_parse_failed"
  | "schema_validation_failed"
  | "no_valid_deliverables"
  | "provider_error";

// User-facing text per failure code — never blames the user's idea for a
// technical failure. "no_valid_deliverables" is the one case where the
// model DID respond with a valid, well-formed plan but genuinely couldn't
// map the idea to any real capability — reformulating can actually help
// there, unlike every other code below.
const PUBLIC_MESSAGES: Record<PlannerErrorCode, string> = {
  empty_response: "La IA devolvió una respuesta vacía. Podés reintentar sin perder créditos.",
  truncated_response:
    "La IA devolvió una respuesta incompleta. Ya reintentamos de forma segura, pero no se pudo completar — podés reintentar sin perder créditos.",
  json_parse_failed:
    "No pudimos interpretar la respuesta de la IA. Podés reintentar sin perder créditos.",
  schema_validation_failed:
    "El plan generado no tenía el formato esperado. Podés reintentar sin perder créditos.",
  no_valid_deliverables: "El plan no propuso ninguna capacidad válida. Probá reformular la idea.",
  provider_error:
    "El servicio de IA tardó más de lo esperado o no respondió. Podés reintentar sin perder créditos.",
};

export class PlannerError extends Error {
  code: PlannerErrorCode;
  constructor(code: PlannerErrorCode, message: string = PUBLIC_MESSAGES[code]) {
    super(message);
    this.code = code;
  }
}

const PlannerResponseSchema = z.object({
  brief: ProjectBriefSchema,
  plan: ProjectPlanSchema,
});

export type PlannerInput = {
  idea: string;
  objective?: string;
  targetAudience?: string;
  language: string;
  plan: "free" | "pro" | "business";
  // Owner/founder entitlement (see lib/auth/is-owner.ts) — lifts the plan
  // gate on which capabilities the planner may propose, without changing
  // `plan` itself or any commercial data.
  isOwner?: boolean;
  // Light onboarding personalization only — never a promise, never the
  // revenue goal (we don't want the model implying it will hit a number
  // the user typed into an unrelated onboarding slider).
  userContext?: { primaryGoal?: string | null; companyName?: string | null };
};

export type PlannerResult = {
  brief: ProjectBrief;
  plan: ProjectPlan;
};

const EXAMPLE_MAPPINGS = `Ejemplos de combinaciones típicas (no son obligatorias, son guía):
- Lanzamiento de ebook: business-plan (para el brief y la oferta) + landing-copy + email-sequences + social-pack.
- Servicio de consultoría: business-plan (posicionamiento/propuesta) + landing-copy + sales-email (outreach) + social-pack.
- Curso online: business-plan (validación y estructura) + landing-copy (oferta) + email-sequences (lanzamiento).
- Producto SaaS: business-plan (brief y roadmap) + landing-copy + email-sequences + social-pack.
Una idea de copy puntual (ej. "necesito un post para LinkedIn") puede necesitar un solo entregable con copywriter.`;

function buildSystemPrompt(caps: ReturnType<typeof listProjectCapabilities>): string {
  const toolList = caps.map((c) => `- "${c.toolKey}": ${c.name} — ${c.description}`).join("\n");

  return `Sos el planner de PostulPro, una plataforma que convierte una idea de negocio en un plan de trabajo ejecutado con herramientas de IA reales.

Tu única tarea: leer la idea del usuario y devolver un objeto JSON — nada de texto antes o después, nada de markdown, solo el JSON.

Capacidades REALES disponibles (usá ÚNICAMENTE estos tool_key, nunca inventes uno nuevo):
${toolList}

${EXAMPLE_MAPPINGS}

Reglas estrictas:
- Máximo 6 entregables. No propongas capacidades que no estén en la lista.
- Separá claramente "knownFacts" (datos que el usuario mencionó explícitamente) de "assumptions" (cosas que vos estás asumiendo porque el usuario no las dio). Nunca inventes datos de mercado, cifras de ingresos, testimonios o usuarios — si falta un dato, es un "assumption" o va en "questionsOrWarnings".
- No prometas ganancias ni resultados garantizados en ningún campo de texto.
- Mantené el mismo idioma que la idea del usuario en todos los campos.
- "brief" es el contexto canónico que van a usar TODOS los entregables — tiene que ser coherente (misma audiencia, mismo tono, misma propuesta de valor) para que los entregables no se contradigan entre sí.
- Cada deliverable.input es el conjunto de datos concretos que esa herramienta va a necesitar (ej: para landing-copy, el producto y el ICP; para business-plan, nombre/problema/solución/país).
- estimatedCredits es solo orientativo — el servidor va a recalcular el costo real, no dependas de que ese número se use tal cual.

Formato exacto de salida (JSON):
{
  "brief": { "name": "", "description": "", "problem": "", "solution": "", "audience": "", "valueProposition": "", "offer": "", "tone": "", "language": "es", "constraints": [], "knownFacts": [], "assumptions": [], "objectives": [], "mainCta": "" },
  "plan": {
    "title": "", "projectType": "", "summary": "", "objective": "", "targetAudience": "", "language": "es",
    "knownFacts": [], "assumptions": [], "questionsOrWarnings": [],
    "deliverables": [ { "toolKey": "", "title": "", "description": "", "reason": "", "dependencies": [], "input": {}, "estimatedCredits": 0 } ],
    "totalEstimatedCredits": 0
  }
}`;
}

function buildUserPrompt(input: PlannerInput): string {
  const lines = [`Idea: ${input.idea}`];
  if (input.objective) lines.push(`Objetivo declarado: ${input.objective}`);
  if (input.targetAudience) lines.push(`Audiencia declarada: ${input.targetAudience}`);
  lines.push(`Idioma de respuesta: ${input.language}`);
  if (input.userContext?.primaryGoal)
    lines.push(
      `Contexto del usuario (solo para personalizar tono, no para prometer resultados): objetivo general "${input.userContext.primaryGoal}"`,
    );
  if (input.userContext?.companyName)
    lines.push(`Nombre de su empresa/proyecto si aplica: ${input.userContext.companyName}`);
  return lines.join("\n");
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

// Safe, mechanical extraction only — never a semantic "repair". If the
// model wrapped the JSON in prose ("Here's the plan:\n{...}\nHope that
// helps!") or a fence stripJsonFences didn't fully catch, take the
// substring between the first "{" and the last "}". Whitespace, fences,
// and surrounding text are the only things this touches; a truncated or
// otherwise broken object still fails JSON.parse right after, exactly as
// it should.
function extractJsonCandidate(raw: string): string {
  const stripped = stripJsonFences(raw);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return stripped;
  return stripped.slice(first, last + 1);
}

// Matches the highest maxTokens already proven safe for this exact model
// (business-plan tool, tools-config.server.ts) rather than guessing at an
// untested ceiling — claude-sonnet-4-5's default (non-extended) output cap
// is well above this, so 8000 is a real, not just theoretical, increase
// from the previous 6000 that a detailed idea (12-field brief + up to 6
// deliverables) could plausibly exceed.
const PLANNER_MAX_TOKENS = 8000;

type ModelAttempt = { text: string; stopReason: string | null };

async function callPlannerModel(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<ModelAttempt> {
  const startedAt = Date.now();
  let stopReason: string | null = null;
  try {
    const text = await callModelOnce(
      { provider: "anthropic", model: CLAUDE, credits: 0, maxTokens, systemPrompt },
      userPrompt,
      undefined,
      (usage) => {
        stopReason = usage.stopReason;
        logModelUsage({
          provider: "anthropic",
          model: CLAUDE,
          operation: "planner",
          usage,
          durationMs: Date.now() - startedAt,
          status: "success",
        });
      },
    );
    return { text, stopReason };
  } catch (err) {
    logModelUsage({
      provider: "anthropic",
      model: CLAUDE,
      operation: "planner",
      usage: { inputTokens: null, outputTokens: null, stopReason: null },
      durationMs: Date.now() - startedAt,
      status: "error",
      errorCode: "provider_error",
    });
    // Never surface the raw provider error (status/body) to the end user —
    // it's logged above for operators; the user gets the safe, generic text.
    throw new PlannerError("provider_error");
  }
}

type PlannerRetryableCode = Exclude<PlannerErrorCode, "no_valid_deliverables" | "provider_error">;

type ParseOutcome =
  | { ok: true; data: PlannerResult }
  | { ok: false; code: PlannerRetryableCode; detail: string };

// Classifies exactly why a response didn't produce a usable plan, using the
// provider's own stop_reason as the signal for "was this actually cut off"
// rather than inferring truncation from response shape. Never collapses
// these into one generic bucket — each is logged and handled distinctly.
function classifyResponse(raw: string, stopReason: string | null): ParseOutcome {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, code: "empty_response", detail: "empty body" };
  }

  const candidate = extractJsonCandidate(raw);
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (err) {
    const truncated = stopReason === "max_tokens" || stopReason === "length";
    return {
      ok: false,
      code: truncated ? "truncated_response" : "json_parse_failed",
      detail: err instanceof Error ? err.message.slice(0, 120) : "parse error",
    };
  }

  const result = PlannerResponseSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      code: "schema_validation_failed",
      detail: issue ? `${issue.path.join(".") || "(root)"}: ${issue.code}` : "schema mismatch",
    };
  }

  return { ok: true, data: result.data };
}

// Safe, structured diagnostic — never the prompt, never the raw response.
function logPlannerParseFailure(attempt: number, code: string, detail: string, raw: string, stopReason: string | null): void {
  console.log(
    JSON.stringify({
      scope: "ai_planner_parse",
      attempt,
      code,
      detail,
      stopReason,
      responseLength: raw.length,
      hasMarkdownFence: /```/.test(raw),
    }),
  );
}

function buildRetryPrompt(userPrompt: string, code: PlannerRetryableCode): string {
  if (code === "truncated_response") {
    return `${userPrompt}\n\nTu respuesta anterior se cortó por exceder el límite de longitud antes de terminar el JSON. Esta vez respondé de forma MÁS BREVE para que entre completo: máximo 4 entregables, "knownFacts"/"assumptions" con máximo 3 elementos cada uno, descripciones de una sola oración. Seguí devolviendo ÚNICAMENTE el objeto JSON exacto descripto arriba, sin texto adicional, y asegurate de cerrar todas las llaves y corchetes.`;
  }
  return `${userPrompt}\n\nTu respuesta anterior no era JSON válido. Respondé ÚNICAMENTE con el objeto JSON exacto descripto arriba, sin texto adicional antes o después, sin bloques de markdown.`;
}

export async function generateProjectPlan(input: PlannerInput): Promise<PlannerResult> {
  const caps = listProjectCapabilities(input.plan, input.isOwner);
  if (caps.length === 0) {
    throw new PlannerError(
      "no_valid_deliverables",
      "No hay herramientas disponibles para tu plan actual.",
    );
  }
  const systemPrompt = buildSystemPrompt(caps);
  const userPrompt = buildUserPrompt(input);

  let { text, stopReason } = await callPlannerModel(systemPrompt, userPrompt, PLANNER_MAX_TOKENS);
  let outcome = classifyResponse(text, stopReason);

  if (!outcome.ok) {
    logPlannerParseFailure(1, outcome.code, outcome.detail, text, stopReason);
    // Exactly one controlled retry, regardless of which of the four
    // classified failure modes occurred — never more than one extra model
    // call per submit, so a stuck provider can't multiply cost or latency.
    const retryPrompt = buildRetryPrompt(userPrompt, outcome.code);
    ({ text, stopReason } = await callPlannerModel(systemPrompt, retryPrompt, PLANNER_MAX_TOKENS));
    outcome = classifyResponse(text, stopReason);
  }

  if (!outcome.ok) {
    logPlannerParseFailure(2, outcome.code, outcome.detail, text, stopReason);
    throw new PlannerError(outcome.code);
  }

  return sanitizePlannerResult(outcome.data);
}

// Cross-checks every deliverable's toolKey against the real allowlist,
// drops anything invented, recalculates credits from the real registry,
// and re-validates the min(1) deliverables constraint.
function sanitizePlannerResult(result: PlannerResult): PlannerResult {
  const allowed = new Set<string>(PLANNER_ALLOWLIST);
  const validDeliverables = result.plan.deliverables
    .filter((d) => allowed.has(d.toolKey))
    .slice(0, 6)
    .map((d) => ({ ...d, estimatedCredits: realCreditsFor(d.toolKey) }));

  if (validDeliverables.length === 0) {
    throw new PlannerError(
      "no_valid_deliverables",
      "El plan no propuso ninguna capacidad válida. Probá reformular la idea.",
    );
  }

  const totalEstimatedCredits = validDeliverables.reduce((sum, d) => sum + d.estimatedCredits, 0);

  return {
    brief: result.brief,
    plan: {
      ...result.plan,
      deliverables: validDeliverables,
      totalEstimatedCredits,
    },
  };
}
