import type { ProjectStatus, StepStatus } from "@/lib/projects/schema";

// Pure, dependency-free state machine helpers — no DB, no fetch. The
// actual enforcement happens server-side in the SECURITY DEFINER RPCs
// (claim_ai_project_step, confirm_ai_project_plan, etc.); this module
// exists so the UI can disable/enable actions correctly and so both can
// be unit-tested without a database.

const CLAIMABLE_STEP_STATUSES: StepStatus[] = ["pending", "ready", "failed"];
const TERMINAL_PROJECT_STATUSES: ProjectStatus[] = ["completed", "archived"];
const TERMINAL_STEP_STATUSES: StepStatus[] = ["completed", "skipped", "cancelled"];

export function canClaimStep(status: StepStatus): boolean {
  return CLAIMABLE_STEP_STATUSES.includes(status);
}

export function canSkipStep(status: StepStatus): boolean {
  return CLAIMABLE_STEP_STATUSES.includes(status);
}

export function isTerminalStepStatus(status: StepStatus): boolean {
  return TERMINAL_STEP_STATUSES.includes(status);
}

export function isTerminalProjectStatus(status: ProjectStatus): boolean {
  return TERMINAL_PROJECT_STATUSES.includes(status);
}

export function canConfirmPlan(status: ProjectStatus, planStale: boolean): boolean {
  return status === "awaiting_confirmation" && !planStale;
}

export function canPause(status: ProjectStatus): boolean {
  return status === "running";
}

export function canResume(status: ProjectStatus): boolean {
  return status === "paused";
}

export function canArchive(status: ProjectStatus): boolean {
  return !isTerminalProjectStatus(status) || status === "completed";
}

export function canRunNext(status: ProjectStatus): boolean {
  return status === "ready" || status === "running" || status === "paused";
}

// Whole-percentage progress from completed+skipped vs. total step count.
export function computeProgress(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

// Deterministic per-step idempotency key — mirrors the SQL side
// (save_ai_project_plan derives the same string), kept here so the
// client and any tests can reproduce/verify it without hitting the DB.
export function deriveStepIdempotencyKey(projectId: string, position: number, toolKey: string): string {
  return `${projectId}::${position}::${toolKey}`;
}

// Shallow-ish structural comparison used to decide whether editing the
// brief should flag the plan as stale. Mirrors the SQL's
// `old IS DISTINCT FROM new` on the whole JSONB blob.
export function briefChanged(oldBrief: unknown, newBrief: unknown): boolean {
  return JSON.stringify(oldBrief) !== JSON.stringify(newBrief);
}
