// Restricts real AI provider calls in the preview environment to a single
// allowlisted QA user OR the canonical admin/owner role, with an explicit
// kill switch on top of both. Production is completely unaffected: every
// check short-circuits to "allowed" unless APP_ENV is exactly "preview",
// which is never set on the production Worker.
//
// Fails closed on preview: if APP_ENV=preview but PREVIEW_AI_ALLOWED_USER_ID
// or AI_GENERATION_ENABLED aren't configured, AI execution is blocked rather
// than silently open to every authenticated user. The kill switch applies to
// admins too — it is an operational off switch, not a per-user restriction.

export type AiGuardResult =
  { allowed: true } | { allowed: false; status: 403 | 503; code: string; message: string };

export function isPreviewEnvironment(): boolean {
  return process.env.APP_ENV === "preview";
}

// userId must already come from a verified session (auth.uid()-derived), and
// isAdmin must already come from a server-side has_role()/role lookup against
// that same session — this function never accepts or trusts a
// client-supplied identifier or flag.
export function checkAiExecutionAllowed(userId: string, isAdmin = false): AiGuardResult {
  if (!isPreviewEnvironment()) return { allowed: true };

  if (process.env.AI_GENERATION_ENABLED !== "true") {
    return {
      allowed: false,
      status: 503,
      code: "ai_disabled_in_preview",
      message: "La generación con IA está deshabilitada en este entorno de preview.",
    };
  }

  if (isAdmin) return { allowed: true };

  const allowedUserId = process.env.PREVIEW_AI_ALLOWED_USER_ID;
  if (!allowedUserId || userId !== allowedUserId) {
    return {
      allowed: false,
      status: 403,
      code: "ai_restricted_in_preview",
      message:
        "La generación con IA en este entorno de preview está restringida a la cuenta de QA.",
    };
  }

  return { allowed: true };
}
