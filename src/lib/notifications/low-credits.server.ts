import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  didCrossLowCreditsThreshold,
  lowCreditsThresholdPercent,
  remainingPercent,
} from "@/lib/notifications/low-credits";
import { lowCreditsIdempotencyKey, currentMonthPeriod } from "@/lib/notifications/idempotency";
import { sendLowCreditsEmail } from "@/lib/resend.server";

type Db = SupabaseClient<Database>;

// Called after a successful reserve_credits, from every code path that
// reserves credits (routes/api/generate-ai.ts and
// lib/projects/executor.server.ts) so the low-credits email fires
// consistently regardless of which one charged the user. Best-effort and
// non-blocking by design: a notification failure must never affect the
// credit reservation or the generation that already succeeded, so this
// never throws.
export async function maybeSendLowCreditsEmail(
  supabase: Db,
  userId: string,
  cost: number,
  creditsUsedAfter: number,
  creditsLimit: number,
  appOrigin?: string,
): Promise<void> {
  try {
    const threshold = lowCreditsThresholdPercent();
    if (!didCrossLowCreditsThreshold(creditsUsedAfter, creditsLimit, cost, threshold)) return;

    // An unconfirmed account can never reach this point in the first place —
    // this project's Auth settings require email confirmation before any
    // sign-in succeeds (Google OAuth identities are pre-verified by Google),
    // so every authenticated userId here already has a confirmed email.
    const { data: profile } = await supabase
      .from("users")
      .select("email,notify_email")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.email) return;
    // Respects the existing Settings > Notificaciones > "email notifications"
    // toggle (routes/_authenticated/settings.tsx) — this is a proactive
    // nudge, not a transactional email, so it must honor an explicit opt-out.
    if (profile.notify_email === false) return;

    const key = lowCreditsIdempotencyKey(userId, threshold, currentMonthPeriod());
    const { data: claimed } = await supabase.rpc("claim_notification", {
      p_key: key,
      p_kind: "low_credits",
    });
    if (!claimed) return;

    await sendLowCreditsEmail(
      profile.email,
      remainingPercent(creditsUsedAfter, creditsLimit),
      appOrigin || "https://postulpro.com",
      key,
    );
  } catch {
    /* best-effort — never break the caller's real work over a notification */
  }
}
