import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getStripe } from "@/lib/stripe.server";
import { sendNewCommissionEmail, sendPaymentFailedEmail, sendProConfirmationEmail } from "@/lib/resend.server";
import type Stripe from "stripe";

// Email sends are best-effort: RESEND_API_KEY isn't configured in this
// environment, and a failed notification must never fail the webhook itself
// (Stripe needs its 200 regardless).
async function safeSend(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    /* not configured yet / delivery failure — ignore */
  }
}

// Stripe webhook. NOT wired to any real endpoint until STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET exist — until then every event fails signature
// verification (or is rejected because Stripe isn't configured at all) and
// nothing here has been exercised against a live Stripe event.
//
// Idempotency: every event id is recorded in stripe_events before we act on
// it (INSERT ... ON CONFLICT DO NOTHING); if it already existed we skip —
// covers Stripe retries and accidental double-delivery.

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !webhookSecret) {
          return new Response("Stripe webhook not configured", { status: 501 });
        }

        const signature = request.headers.get("stripe-signature");
        if (!signature) return new Response("Missing signature", { status: 400 });

        const rawBody = await request.text();
        let event: Stripe.Event;
        try {
          const stripe = getStripe();
          event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
          return new Response(`Invalid signature: ${err instanceof Error ? err.message : "unknown"}`, { status: 400 });
        }

        const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { error: dedupeErr } = await admin.from("stripe_events").insert({ id: event.id });
        if (dedupeErr) {
          // Unique violation = already processed this event id. Any other
          // error we surface as a 500 so Stripe retries.
          if (dedupeErr.code === "23505") return new Response("Already processed", { status: 200 });
          return new Response("Dedupe insert failed", { status: 500 });
        }

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              const userId = session.client_reference_id ?? session.metadata?.user_id;
              if (!userId) break;

              if (session.metadata?.kind === "credits") {
                const { data: profile } = await admin.from("users").select("credits_limit").eq("id", userId).maybeSingle();
                if (profile) {
                  await admin.from("users").update({ credits_limit: profile.credits_limit + 100 }).eq("id", userId);
                }
              }
              // Marketplace one-time purchases would be identified via a
              // different metadata.kind ("marketplace") once that checkout
              // path exists; not wired yet since /marketplace's "Comprar
              // ahora" is still a placeholder (Fase 4).
              break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated": {
              const sub = event.data.object as Stripe.Subscription;
              const userId = sub.metadata?.user_id;
              if (!userId) break;
              const priceId = sub.items.data[0]?.price?.id;
              const plan = priceId?.includes("business") ? "business" : "pro";
              const creditsLimit = plan === "business" ? 500 : 100;

              await admin.from("subscriptions").upsert(
                {
                  user_id: userId,
                  stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
                  stripe_subscription_id: sub.id,
                  plan,
                  status: sub.status,
                  current_period_end: new Date(sub.items.data[0]?.current_period_end * 1000).toISOString(),
                },
                { onConflict: "stripe_subscription_id" },
              );
              await admin.from("users").update({ plan, credits_limit: creditsLimit }).eq("id", userId);

              if (event.type === "customer.subscription.created") {
                const { data: profile } = await admin.from("users").select("email").eq("id", userId).maybeSingle();
                if (profile) await safeSend(() => sendProConfirmationEmail(profile.email, plan));
              }
              break;
            }
            case "customer.subscription.deleted": {
              const sub = event.data.object as Stripe.Subscription;
              const userId = sub.metadata?.user_id;
              if (!userId) break;
              await admin.from("subscriptions").update({ status: "canceled" }).eq("stripe_subscription_id", sub.id);
              await admin.from("users").update({ plan: "free", credits_limit: 10 }).eq("id", userId);
              break;
            }
            case "invoice.payment_failed": {
              const invoice = event.data.object as Stripe.Invoice;
              const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
              if (!customerId) break;
              const { data: sub } = await admin.from("subscriptions").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
              if (!sub) break;
              const { data: profile } = await admin.from("users").select("email").eq("id", sub.user_id).maybeSingle();
              if (profile) await safeSend(() => sendPaymentFailedEmail(profile.email, event.id));
              break;
            }
            case "invoice.payment_succeeded": {
              // Recurring commission: if the paying user was referred, credit
              // their referrer commission_amount = invoice amount * rate.
              const invoice = event.data.object as Stripe.Invoice;
              const subscriptionId =
                typeof invoice.parent?.subscription_details?.subscription === "string"
                  ? invoice.parent.subscription_details.subscription
                  : undefined;
              if (!subscriptionId) break;
              const { data: subRow } = await admin
                .from("subscriptions")
                .select("user_id")
                .eq("stripe_subscription_id", subscriptionId)
                .maybeSingle();
              if (!subRow) break;

              const { data: referral } = await admin
                .from("affiliate_referrals")
                .select("id,referrer_id,commission_rate,commission_amount")
                .eq("referred_user_id", subRow.user_id)
                .maybeSingle();
              if (!referral || !referral.commission_rate) break;

              const amountPaid = invoice.amount_paid / 100;
              const commission = amountPaid * (referral.commission_rate / 100);
              await admin
                .from("affiliate_referrals")
                .update({ commission_amount: (referral.commission_amount ?? 0) + commission })
                .eq("id", referral.id);

              const { data: referrerProfile } = await admin.from("users").select("email").eq("id", referral.referrer_id).maybeSingle();
              if (referrerProfile) await safeSend(() => sendNewCommissionEmail(referrerProfile.email, commission));
              break;
            }
            default:
              break;
          }
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "Webhook handling failed", { status: 500 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
