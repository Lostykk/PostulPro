import { z } from "zod";

// Shared Zod schemas for the AI Project Builder. Safe to import from both
// server and client code — no secrets or prompts live here, only the
// shape of data that crosses the wire.

export const MAX_DELIVERABLES = 6;
export const IDEA_MIN_LEN = 8;
export const IDEA_MAX_LEN = 4000;

export const CreateProjectInputSchema = z.object({
  idea: z.string().trim().min(IDEA_MIN_LEN, "Contanos un poco más sobre tu idea.").max(IDEA_MAX_LEN, "La idea es demasiado larga."),
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
  deliverables: z.array(PlanDeliverableSchema).min(1, "El plan necesita al menos un entregable.").max(MAX_DELIVERABLES),
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
