// Whether POST /api/projects/:id/plan may (re)run for a project in this
// exact state. Extracted as a pure function so the retry/recovery matrix is
// unit-testable without a real Supabase call — see routes/api/projects/$id.plan.ts.
//
// "failed" is only retriable when no plan was ever saved (hasPlan=false) —
// i.e. it failed during planning itself, before any deliverable/step
// existed. A project that failed later, during step execution, already has
// a plan and real progress (steps, spent credits); regenerating the plan
// there would silently wipe that progress, so it's excluded on purpose and
// left to the step-level retry endpoints instead.
export function canRetryPlanning(status: string, hasPlan: boolean): boolean {
  if (status === "planning" || status === "awaiting_confirmation") return true;
  return status === "failed" && !hasPlan;
}
