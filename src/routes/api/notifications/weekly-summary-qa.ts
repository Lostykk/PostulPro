import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import {
  checkWeeklySummaryQaAllowed,
  generateWeeklySummaryData,
} from "@/lib/notifications/weekly-summary.server";
import { weeklySummaryIdempotencyKey, isoWeek } from "@/lib/notifications/idempotency";
import { sendWeeklySummaryEmail } from "@/lib/resend.server";

// POST /api/notifications/weekly-summary-qa — manual, QA-only trigger.
// There is no real weekly cron: no notification-preferences/consent system
// exists yet, so an automatic send-to-everyone job stays off by product
// decision (see docs/production-environment-manifest.md). This endpoint
// only exists so the flow can be validated end-to-end in preview, gated to
// the single allowlisted QA account and only when APP_ENV=preview — see
// checkWeeklySummaryQaAllowed, which fails closed in production by
// construction, not by convention. Always generates and sends for the
// caller's own account only; never accepts a target user id.
export const Route = createFileRoute("/api/notifications/weekly-summary-qa")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const guard = checkWeeklySummaryQaAllowed(userId);
        if (!guard.allowed) return json({ error: guard.message, code: guard.code }, guard.status);

        const { data: profile } = await supabase
          .from("users")
          .select("email,notify_email")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.email) return json({ sent: false, reason: "no_email_on_profile" }, 409);
        // Even the manual QA trigger respects the existing notify_email
        // preference (Settings > Notificaciones) — proves the real cron
        // would too, once/if it's ever turned on.
        if (profile.notify_email === false) {
          return json({ sent: false, reason: "notifications_opted_out" }, 200);
        }

        const week = isoWeek();
        const key = weeklySummaryIdempotencyKey(userId, week);
        const { data: claimed, error: claimErr } = await supabase.rpc("claim_notification", {
          p_key: key,
          p_kind: "weekly_summary",
        });
        if (claimErr) return json({ sent: false, reason: "claim_failed" }, 500);
        if (!claimed) return json({ sent: false, reason: "already_sent_this_week" }, 200);

        const stats = await generateWeeklySummaryData(supabase, userId);
        try {
          await sendWeeklySummaryEmail(profile.email, stats, new URL(request.url).origin, key);
        } catch {
          return json({ sent: false, reason: "delivery_failed" }, 200);
        }

        return json({ sent: true, stats }, 200);
      },
    },
  },
});
