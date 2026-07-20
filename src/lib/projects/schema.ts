import { z } from "zod";

// Shared Zod schemas for the AI Project Builder. Safe to import from both
// server and client code — no secrets or prompts live here, only the
// shape of data that crosses the wire.

export const MAX_DELIVERABLES = 6;
export const IDEA_MIN_LEN = 8;
export const IDEA_MAX_LEN = 4000;

export const CreateProjectInputSchema = z.object({
  idea: z
    .string()
    .trim()
    .min(IDEA_MIN_LEN, "Contanos un poco más sobre tu idea.")
    .max(IDEA_MAX_LEN, "La idea es demasiado larga."),
  objective: z.string().trim().max(300).optional(),
  targetAudience: z.string().trim().max(300).optional(),
  language: z.string().trim().min(2).max(10).default("es"),
  executionMode: z.enum(["guided", "automatic"]).default("guided"),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

// The canonical project brief (section 10 of the spec) — the single
// source of context every step's prompt is built from.
export const ProjectBriefSchema = z.object({
  name: z.string().trim().max(120).default(""),
  description: z.string().trim().max(600).default(""),
  problem: z.string().trim().max(500).default(""),
  solution: z.string().trim().max(500).default(""),
  audience: z.string().trim().max(300).default(""),
  valueProposition: z.string().trim().max(400).default(""),
  offer: z.string().trim().max(300).default(""),
  // 200 (not the original 120) with real headroom: a real planner run
  // showed the model consistently writing a short descriptive phrase here
  // ("profesional pero cercano y accesible, transmitiendo confianza...")
  // rather than a couple of words — 120 rejected valid, well-formed
  // responses on both the first attempt and the identical retry.
  tone: z.string().trim().max(200).default(""),
  language: z.string().trim().min(2).max(10).default("es"),
  constraints: z.array(z.string().trim().max(200)).max(10).default([]),
  knownFacts: z.array(z.string().trim().max(300)).max(15).default([]),
  assumptions: z.array(z.string().trim().max(300)).max(15).default([]),
  objectives: z.array(z.string().trim().max(200)).max(8).default([]),
  mainCta: z.string().trim().max(120).default(""),
});
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export const PlanDeliverableSchema = z.object({
  toolKey: z.string().min(1).max(60),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
  reason: z.string().trim().max(300).default(""),
  dependencies: z.array(z.string()).max(MAX_DELIVERABLES).default([]),
  input: z.record(z.string(), z.unknown()).default({}),
  // Untrusted — the server always recalculates this from the real tool
  // registry before persisting or charging anything, so this cap only
  // needs to keep the type sane (non-negative integer), not tight — a real
  // planner run showed the model's own (later-discarded) estimate for a
  // single deliverable exceeding the old cap of 50, rejecting an otherwise
  // valid plan over a number nothing ever actually uses.
  estimatedCredits: z.number().int().min(0).max(999).default(0),
});
export type PlanDeliverable = z.infer<typeof PlanDeliverableSchema>;

export const ProjectPlanSchema = z.object({
  title: z.string().trim().min(2).max(120),
  projectType: z.string().trim().max(60).default("other"),
  summary: z.string().trim().max(500).default(""),
  objective: z.string().trim().max(300).default(""),
  targetAudience: z.string().trim().max(300).default(""),
  language: z.string().trim().min(2).max(10).default("es"),
  knownFacts: z.array(z.string().trim().max(300)).max(15).default([]),
  assumptions: z.array(z.string().trim().max(300)).max(15).default([]),
  questionsOrWarnings: z.array(z.string().trim().max(300)).max(10).default([]),
  deliverables: z
    .array(PlanDeliverableSchema)
    .min(1, "El plan necesita al menos un entregable.")
    .max(MAX_DELIVERABLES),
  totalEstimatedCredits: z.number().int().min(0).default(0),
});
export type ProjectPlan = z.infer<typeof ProjectPlanSchema>;

export const UpdateBriefInputSchema = ProjectBriefSchema.partial();

export const ProjectStatusEnum = z.enum([
  "draft",
  "planning",
  "awaiting_confirmation",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
  "archived",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusEnum>;

export const StepStatusEnum = z.enum([
  "pending",
  "ready",
  "running",
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);
export type StepStatus = z.infer<typeof StepStatusEnum>;

// User-facing text for every last_error_code a failed-during-planning
// project can carry — never blames the user's idea/billing for a technical
// or environment-restriction failure. Covers both the planner's own codes
// (lib/projects/planner.server.ts's PlannerErrorCode) and the gate
// rejections that precede it (preview guard, rate limit — see
// routes/api/projects/$id.plan.ts and
// docs/build-with-ai-stuck-project-incident.md), plus the reconciler's
// 'timeout'. Falls back to a safe generic message for any other/unknown
// code so a new failure mode never renders blank.
export const PLANNING_FAILURE_MESSAGES: Record<string, string> = {
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
  persistence_failed: "No pudimos terminar de guardar tu proyecto. Tu saldo no fue afectado.",
  ai_disabled_in_preview:
    "La generación con IA está deshabilitada temporalmente en este entorno de preview.",
  ai_restricted_in_preview:
    "La generación con IA en este entorno de preview está restringida a la cuenta de QA.",
  rate_limited:
    "Alcanzaste el límite de planes que podés generar por ahora. Probá de nuevo más tarde.",
  rate_limit_unavailable:
    "No pudimos verificar el límite de solicitudes. Probá de nuevo en un momento.",
  timeout:
    "La planificación tardó demasiado y fue cancelada. Podés reintentar sin perder créditos.",
};

export const DEFAULT_PLANNING_FAILURE_MESSAGE =
  "No pudimos completar la planificación. Tu saldo no fue afectado. Podés reintentar este mismo proyecto.";

export function planningFailureMessage(errorCode: string | null | undefined): string {
  if (!errorCode) return DEFAULT_PLANNING_FAILURE_MESSAGE;
  return PLANNING_FAILURE_MESSAGES[errorCode] ?? DEFAULT_PLANNING_FAILURE_MESSAGE;
}
