import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isPreviewEnvironment } from "@/lib/ai/preview-guard.server";

type Db = SupabaseClient<Database>;

// No user-facing notification-preferences system exists yet in this
// codebase (no opt-in/opt-out table, no consent flag) — see
// docs/production-environment-manifest.md. Per product decision, the real
// weekly-summary cron stays OFF until that exists; this guard is what keeps
// it off by construction rather than by a comment someone could forget to
// respect. It reuses the same "preview + single allowlisted QA user" gate
// already used for real AI provider calls (lib/ai/preview-guard.server.ts),
// so it fails closed in production by definition: isPreviewEnvironment() is
// only ever true when APP_ENV=preview, which production never sets.
export type WeeklySummaryGuardResult =
  { allowed: true } | { allowed: false; status: 403 | 503; code: string; message: string };

export function checkWeeklySummaryQaAllowed(userId: string): WeeklySummaryGuardResult {
  if (!isPreviewEnvironment()) {
    return {
      allowed: false,
      status: 503,
      code: "weekly_summary_disabled",
      message: "El resumen semanal no está habilitado (sin sistema de preferencias todavía).",
    };
  }
  const allowedUserId = process.env.PREVIEW_AI_ALLOWED_USER_ID;
  if (!allowedUserId || userId !== allowedUserId) {
    return {
      allowed: false,
      status: 403,
      code: "weekly_summary_restricted",
      message: "El envío manual de QA está restringido a la cuenta de QA en preview.",
    };
  }
  return { allowed: true };
}

export type WeeklySummaryStats = { generations: number; tokensUsed: number };

// Scoped strictly to the requesting user's own rows (WHERE user_id = userId)
// — never accepts or infers another user's id, so there's no cross-account
// data exposure path here.
export async function generateWeeklySummaryData(
  supabase: Db,
  userId: string,
  now: Date = new Date(),
): Promise<WeeklySummaryStats> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("generations")
    .select("tokens_used")
    .eq("user_id", userId)
    .gte("created_at", since);

  const rows = data ?? [];
  const tokensUsed = rows.reduce((sum, row) => sum + (row.tokens_used ?? 0), 0);
  return { generations: rows.length, tokensUsed };
}
