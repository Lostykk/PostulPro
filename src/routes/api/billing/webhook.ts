import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Database } from "@/integrations/supabase/types";
import { findMappingByVariantId, verifyWebhookSignature, type RemoteSubscription } from "@/lib/lemon-squeezy.server";
import { sendNewCommissionEmail, sendPaymentFailedEmail, sendProConfirmationEmail } from "@/lib/resend.server";

// Email sends are best-effort: RESEND_API_KEY isn't configured in this
// environment, and a failed notification must never fail the webhook itself
// (Lemon Squeezy needs its 200 regardless).
async function safeSend(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    /* not configured yet / delivery failure — ignore */
  }
}

type LemonSqueezyPayload = {
  meta: { event_name: string; custom_data?: { user_id?: string } };
  data: { id: string; type: string; attributes: Record<string, unknown> };
};

type OrderAttributes = {
  status: string;
  first_order_item?: { variant_id: number | string };
};

// The subscription-invoice resource sent for subscription_payment_success /
// subscription_payment_failed. Its exact attribute set isn't independently
// verified against a real Test Mode payload yet (see migration report) —
// `subscription_id` and `total` are the two fields this handler depends on,
// per docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object.
type SubscriptionInvoiceAttributes = {
  subscription_id: number | string;
  total: number;
  status: string;
};

// Lemon Squeezy webhook. NOT wired to any real endpoint until
// LEMON_SQUEEZY_WEBHOOK_SECRET (and the API key/store id used elsewhere in
// billing) exist — until then every event is rejected for missing config,
// and nothing here has been exercised against a live Lemon Squeezy event,
// Test Mode included.
//
// Idempotency: Lemon Squeezy doesn't hand out a stable per-delivery event id
// in the payload the way Stripe does, so the ledger key is sha256(raw body)
// — a genuine retry/duplicate delivery is byte-identical and hashes the
// same, while any real state change (status, updated_at, etc.) hashes
// differently. Recorded in lemon_squeezy_events before acting on it
// (INSERT, unique violation = already processed).

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
        if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !webhookSecret) {
          return new Response("Lemon Squeezy webhook not configured", { status: 501 });
        }

        // Raw body read once, verified before any JSON.parse — re-serializing
        // parsed JSON would change the bytes and break signature comparison.
        const rawBody = await request.text();
        const signature = request.headers.get("x-signature");
        if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
          return new Response("Invalid signature", { status: 400 });
        }

        let payload: LemonSqueezyPayload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const eventName = payload.meta?.event_name;
        if (!eventName) return new Response("Missing event_name", { status: 400 });

        const eventId = createHash("sha256").update(rawBody).digest("hex");

        const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { error: dedupeErr } = await admin.from("lemon_squeezy_events").insert({ id: eventId, event_name: eventName });
        if (dedupeErr) {
          // Unique violation = already processed this exact payload. Any
          // other error we surface as a 500 so Lemon Squeezy retries.
          if (dedupeErr.code === "23505") return new Response("Already processed", { status: 200 });
          return new Response("Dedupe insert failed", { status: 500 });
        }

        try {
          const userId = payload.meta.custom_data?.user_id;
          const providerSubscriptionId = payload.data.id;

          switch (eventName) {
            case "order_created": {
              const order = payload.data.attributes as OrderAttributes;
              if (order.status !== "paid") break;
              if (!userId) break;
              const variantId = order.first_order_item?.variant_id;
              const mapping = variantId !== undefined ? findMappingByVariantId(String(variantId)) : undefined;
              if (mapping?.kind === "credits") {
                const { data: profile } = await admin.from("users").select("credits_limit").eq("id", userId).maybeSingle();
                if (profile) {
                  await admin.from("users").update({ credits_limit: profile.credits_limit + mapping.amount }).eq("id", userId);
                }
              }
              // Marketplace one-time purchases would be identified via a
              // different mapping once that checkout path exists; not wired
              // yet since /marketplace's "Comprar ahora" is still a
              // placeholder (Fase 4).
              break;
            }
            case "subscription_created":
            case "subscription_updated": {
              const sub = payload.data.attributes as RemoteSubscription["attributes"];
              if (!userId) break;
              const variantId = String(sub.variant_id);
              const mapping = findMappingByVariantId(variantId);
              const plan = mapping?.kind === "subscription" ? mapping.plan : undefined;
              const interval = mapping?.kind === "subscription" ? mapping.interval : undefined;

              await admin.from("subscriptions").upsert(
                {
                  user_id: userId,
                  provider: "lemon_squeezy",
                  provider_customer_id: String(sub.customer_id),
                  provider_subscription_id: providerSubscriptionId,
                  product_id: String(sub.product_id),
                  variant_id: variantId,
                  plan: plan ?? null,
                  status: sub.status,
                  billing_interval: interval ?? null,
                  renews_at: sub.renews_at,
                  ends_at: sub.ends_at,
                  trial_ends_at: sub.trial_ends_at,
                  cancelled: sub.cancelled ?? false,
                },
                { onConflict: "provider_subscription_id" },
              );

              if (plan) {
                const creditsLimit = plan === "business" ? 500 : 100;
                await admin.from("users").update({ plan, credits_limit: creditsLimit }).eq("id", userId);
              }

              if (eventName === "subscription_created" && plan) {
                const { data: profile } = await admin.from("users").select("email").eq("id", userId).maybeSingle();
                if (profile) await safeSend(() => sendProConfirmationEmail(profile.email, plan));
              }
              break;
            }
            case "subscription_cancelled": {
              const sub = payload.data.attributes as RemoteSubscription["attributes"];
              await admin
                .from("subscriptions")
                .update({ status: sub.status, cancelled: true, ends_at: sub.ends_at })
                .eq("provider_subscription_id", providerSubscriptionId);
              break;
            }
            case "subscription_resumed": {
              const sub = payload.data.attributes as RemoteSubscription["attributes"];
              await admin
                .from("subscriptions")
                .update({ status: sub.status, cancelled: false, ends_at: null })
                .eq("provider_subscription_id", providerSubscriptionId);
              break;
            }
            case "subscription_expired": {
              const { data: subRow } = await admin
                .from("subscriptions")
                .update({ status: "expired" })
                .eq("provider_subscription_id", providerSubscriptionId)
                .select("user_id")
                .maybeSingle();
              const expiredUserId = userId ?? subRow?.user_id;
              if (expiredUserId) await admin.from("users").update({ plan: "free", credits_limit: 10 }).eq("id", expiredUserId);
              break;
            }
            case "subscription_paused":
            case "subscription_unpaused": {
              const sub = payload.data.attributes as RemoteSubscription["attributes"];
              await admin.from("subscriptions").update({ status: sub.status }).eq("provider_subscription_id", providerSubscriptionId);
              break;
            }
            case "subscription_payment_failed": {
              const invoice = payload.data.attributes as SubscriptionInvoiceAttributes;
              const { data: subRow } = await admin
                .from("subscriptions")
                .select("user_id")
                .eq("provider_subscription_id", String(invoice.subscription_id))
                .maybeSingle();
              if (!subRow) break;
              const { data: profile } = await admin.from("users").select("email").eq("id", subRow.user_id).maybeSingle();
              if (profile) await safeSend(() => sendPaymentFailedEmail(profile.email, eventId));
              break;
            }
            case "subscription_payment_success": {
              // Recurring commission: if the paying user was referred, credit
              // their referrer commission_amount = invoice amount * rate.
              const invoice = payload.data.attributes as SubscriptionInvoiceAttributes;
              const { data: subRow } = await admin
                .from("subscriptions")
                .select("user_id")
                .eq("provider_subscription_id", String(invoice.subscription_id))
                .maybeSingle();
              if (!subRow) break;

              const { data: referral } = await admin
                .from("affiliate_referrals")
                .select("id,referrer_id,commission_rate,commission_amount")
                .eq("referred_user_id", subRow.user_id)
                .maybeSingle();
              if (!referral || !referral.commission_rate) break;

              const amountPaid = invoice.total / 100;
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
