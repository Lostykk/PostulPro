import { CLAUDE } from "@/lib/ai/tools-config.server";
import { callModelOnce } from "@/lib/ai/call-model.server";
import { PLANNER_ALLOWLIST, listProjectCapabilities, realCreditsFor } from "@/lib/projects/capabilities.server";
import { ProjectBriefSchema, ProjectPlanSchema, type ProjectBrief, type ProjectPlan } from "@/lib/projects/schema";
import { z } from "zod";

// The server-side planner: turns a free-text idea into a structured,
// server-verified plan + brief. The model's own numbers (estimatedCredits,
// tool choice) are never trusted as-is — every deliverable is cross-checked
// against the real capability allowlist and every cost is recalculated
// from the real tool registry before this function returns.

export class PlannerError extends Error {
  code: "invalid_response" | "no_valid_deliverables" | "provider_error";
  constructor(code: PlannerError["code"], message: string) {
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
  const toolList = caps
    .map((c) => `- "${c.toolKey}": ${c.name} — ${c.description}`)
    .join("\n");

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
  if (input.userContext?.primaryGoal) lines.push(`Contexto del usuario (solo para personalizar tono, no para prometer resultados): objetivo general "${input.userContext.primaryGoal}"`);
  if (input.userContext?.companyName) lines.push(`Nombre de su empresa/proyecto si aplica: ${input.userContext.companyName}`);
  return lines.join("\n");
}

function stripJsonFences(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
}

async function callPlannerModel(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    return await callModelOnce(
      { provider: "anthropic", model: CLAUDE, credits: 0, maxTokens: 3000, systemPrompt },
      userPrompt,
    );
  } catch (err) {
    throw new PlannerError("provider_error", err instanceof Error ? err.message : "Planner model call failed");
  }
}

export async function generateProjectPlan(input: PlannerInput): Promise<PlannerResult> {
  const caps = listProjectCapabilities(input.plan);
  if (caps.length === 0) {
    throw new PlannerError("no_valid_deliverables", "No hay herramientas disponibles para tu plan actual.");
  }
  const systemPrompt = buildSystemPrompt(caps);
  const userPrompt = buildUserPrompt(input);

  let raw = await callPlannerModel(systemPrompt, userPrompt);
  let parsed = tryParse(raw);

  if (!parsed) {
    // One correction retry: tell the model exactly what went wrong.
    raw = await callPlannerModel(
      systemPrompt,
      `${userPrompt}\n\nTu respuesta anterior no era JSON válido. Respondé ÚNICAMENTE con el objeto JSON exacto descripto arriba, sin texto adicional.`,
    );
    parsed = tryParse(raw);
  }

  if (!parsed) {
    throw new PlannerError("invalid_response", "No pudimos interpretar el plan generado. Probá reformular la idea.");
  }

  return sanitizePlannerResult(parsed);
}

function tryParse(raw: string): PlannerResult | null {
  try {
    const json = JSON.parse(stripJsonFences(raw));
    const result = PlannerResponseSchema.safeParse(json);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
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
    throw new PlannerError("no_valid_deliverables", "El plan no propuso ninguna capacidad válida. Probá reformular la idea.");
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
