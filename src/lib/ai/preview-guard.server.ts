// Restricts real AI provider calls in the preview environment to an
// allowlisted set of QA users OR the canonical admin/owner role, with an
// explicit kill switch on top of both. Production is completely unaffected:
// every check short-circuits to "allowed" unless APP_ENV is exactly
// "preview", which is never set on the production Worker.
//
// Fails closed on preview: if APP_ENV=preview but neither allowlist entry
// point (user id or email) resolves anyone, or AI_GENERATION_ENABLED isn't
// configured, AI execution is blocked rather than silently open to every
// authenticated user. The kill switch applies to admins too — it is an
// operational off switch, not a per-user restriction.
//
// Two allowlist mechanisms, both additive (never replacing each other):
//   - PREVIEW_AI_ALLOWED_USER_ID: single stable user id (original mechanism,
//     unchanged — whatever account it already names keeps working).
//   - PREVIEW_AI_ALLOWED_EMAILS: comma-separated emails, for QA accounts
//     added later without needing that account's raw user id (which this
//     guard has no way to look up on its own — the caller already has the
//     authenticated user's own row, email included, from the same profile
//     lookup it uses for the role check).
// See docs/build-with-ai-stuck-project-incident.md for why this exists.

export type AiGuardResult =
  { allowed: true } | { allowed: false; status: 403 | 503; code: string; message: string };

export function isPreviewEnvironment(): boolean {
  return process.env.APP_ENV === "preview";
}

function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

// userId/email must already come from a verified session/row (auth.uid()
// and that same user's own `users.email`), and isAdmin must already come
// from a server-side has_role()/role lookup against that same session —
// this function never accepts or trusts a client-supplied identifier, email,
// or flag.
export function checkAiExecutionAllowed(
  userId: string,
  isAdmin = false,
  email: string | null | undefined = null,
): AiGuardResult {
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
  if (allowedUserId && userId === allowedUserId) return { allowed: true };

  const allowedEmails = parseAllowedEmails(process.env.PREVIEW_AI_ALLOWED_EMAILS);
  if (email && allowedEmails.includes(email.trim().toLowerCase())) return { allowed: true };

  return {
    allowed: false,
    status: 403,
    code: "ai_restricted_in_preview",
    message: "La generación con IA en este entorno de preview está restringida a la cuenta de QA.",
  };
}
