import { createFileRoute } from "@tanstack/react-router";
import { authenticate, isAuthedCtx, json } from "@/lib/api-auth.server";
import { welcomeIdempotencyKey } from "@/lib/notifications/idempotency";
import { sendWelcomeEmail } from "@/lib/resend.server";

// POST /api/notifications/welcome — called once, client-side, right after
// the onboarding wizard's complete_onboarding RPC succeeds (see
// routes/_authenticated/onboarding.tsx). Re-checks onboarding_completed
// itself server-side rather than trusting the caller's timing, and claims a
// per-user idempotency slot before sending — so a double click, a retried
// fetch, or the same user revisiting onboarding can never result in two
// welcome emails. A send failure is reported but never surfaced as a hard
// error to the onboarding flow that just genuinely succeeded.

export const Route = createFileRoute("/api/notifications/welcome")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = await authenticate(request);
        if (!isAuthedCtx(ctx)) return ctx;
        const { supabase, userId } = ctx;

        const { data: profile } = await supabase
          .from("users")
          .select("email,name,onboarding_completed")
          .eq("id", userId)
          .maybeSingle();

        // Email confirmation is enforced globally at sign-in (this project's
        // Auth settings require it), so any authenticated userId here
        // already has a verified email — onboarding_completed is the one
        // real precondition left to check.
        if (!profile?.onboarding_completed) {
          return json({ sent: false, reason: "onboarding_not_completed" }, 409);
        }
        if (!profile.email) {
          return json({ sent: false, reason: "no_email_on_profile" }, 409);
        }

        const key = welcomeIdempotencyKey(userId);
        const { data: claimed, error: claimErr } = await supabase.rpc("claim_notification", {
          p_key: key,
          p_kind: "welcome",
        });
        if (claimErr) return json({ sent: false, reason: "claim_failed" }, 500);
        if (!claimed) return json({ sent: false, reason: "already_sent" }, 200);

        try {
          await sendWelcomeEmail(
            profile.email,
            profile.name ?? "",
            new URL(request.url).origin,
            key,
          );
        } catch {
          // The idempotency slot is already claimed on purpose: a delivery
          // failure here should not turn into an automatic client-side
          // retry loop that could spam Resend. Product can add an explicit
          // retry path later if this ever proves too strict in practice.
          return json({ sent: false, reason: "delivery_failed" }, 200);
        }

        return json({ sent: true }, 200);
      },
    },
  },
});
