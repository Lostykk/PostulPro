// Supabase Edge Function: Lemon Squeezy billing webhook.
//
// Deployed directly to the Supabase project (not the Cloudflare Worker) so it
// gets SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY auto-injected by the platform
// at runtime — no manual service-role secret handling required. Mirrors the
// logic in src/routes/api/billing/webhook.ts + src/lib/lemon-squeezy.server.ts
// from the main app (kept in sync manually since this runs in a separate
// Deno runtime and can't share those TS modules directly).
//
// Only custom secret required: LEMON_SQUEEZY_WEBHOOK_SECRET (set via
// `supabase secrets set`). Variant IDs are not secret — hardcoded below,
// same values as the LEMON_SQUEEZY_VARIANT_* vars in the main app.

import { createClient } from "npm:@supabase/supabase-js@2";

type VariantKey = "pro_monthly" | "pro_annual" | "business_monthly" | "business_annual" | "credits_100";

type VariantMapping =
  | { kind: "subscription"; plan: "pro" | "business"; interval: "month" | "year" }
  | { kind: "credits"; amount: number };

// Same variant ids configured in Lemon Squeezy Test Mode store #425914.
const VARIANT_IDS: Record<VariantKey, string> = {
  pro_monthly: "1879841",
  pro_annual: "1879894",
  business_monthly: "1882316",
  business_annual: "1882302",
  credits_100: "1882329",
};

const VARIANT_PLAN_MAP: Record<VariantKey, VariantMapping> = {
  pro_monthly: { kind: "subscription", plan: "pro", interval: "month" },
  pro_annual: { kind: "subscription", plan: "pro", interval: "year" },
  business_monthly: { kind: "subscription", plan: "business", interval: "month" },
  business_annual: { kind: "subscription", plan: "business", interval: "year" },
  credits_100: { kind: "credits", amount: 100 },
};

function findMappingByVariantId(variantId: string): VariantMapping | undefined {
  for (const key of Object.keys(VARIANT_IDS) as VariantKey[]) {
    if (VARIANT_IDS[key] === variantId) return VARIANT_PLAN_MAP[key];
  }
  return undefined;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

async function hmacSha256Hex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return toHex(sig);
}

// Manual constant-time compare — Web Crypto has no timingSafeEqual.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const digest = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqualStr(digest, signatureHeader);
}

type LemonSqueezyPayload = {
  meta: { event_name: string; custom_data?: { user_id?: string } };
  data: { id: string; type: string; attributes: Record<string, unknown> };
};

type OrderAttributes = {
  status: string;
  first_order_item?: { variant_id: number | string };
};

type RemoteSubscriptionAttributes = {
  customer_id: number;
  product_id: number;
  variant_id: number;
  status: string;
  renews_at: string | null;
  ends_at: string | null;
  trial_ends_at: string | null;
  cancelled: boolean;
};

type SubscriptionInvoiceAttributes = {
  subscription_id: number | string;
  total: number;
  status: string;
};

async function safeSend(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    /* best-effort — a failed email must never fail the webhook */
  }
}

async function sendEmail(to: string, subject: string, html: string, idempotencyKey?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: "PostulPro <notificaciones@postulpro.com>", to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend API error (${res.status})`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("LEMON_SQUEEZY_WEBHOOK_SECRET");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !webhookSecret) {
    return new Response("Lemon Squeezy webhook not configured", { status: 501 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-signature");
  if (!(await verifyWebhookSignature(rawBody, signature, webhookSecret))) {
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

  const eventId = await sha256Hex(rawBody);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: dedupeErr } = await admin.from("lemon_squeezy_events").insert({ id: eventId, event_name: eventName });
  if (dedupeErr) {
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
        break;
      }
      case "subscription_created":
      case "subscription_updated": {
        const sub = payload.data.attributes as RemoteSubscriptionAttributes;
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
          if (profile) {
            await safeSend(() =>
              sendEmail(
                profile.email,
                `Tu plan ${plan.toUpperCase()} está activo`,
                `<p>Tu suscripción ${plan.toUpperCase()} ya está activa.</p>`,
                eventId,
              )
            );
          }
        }
        break;
      }
      case "subscription_cancelled": {
        const sub = payload.data.attributes as RemoteSubscriptionAttributes;
        await admin
          .from("subscriptions")
          .update({ status: sub.status, cancelled: true, ends_at: sub.ends_at })
          .eq("provider_subscription_id", providerSubscriptionId);
        break;
      }
      case "subscription_resumed": {
        const sub = payload.data.attributes as RemoteSubscriptionAttributes;
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
        const sub = payload.data.attributes as RemoteSubscriptionAttributes;
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
        if (profile) {
          await safeSend(() =>
            sendEmail(profile.email, "No pudimos procesar tu pago", "<p>Tu último intento de cobro no se pudo procesar.</p>", eventId)
          );
        }
        break;
      }
      case "subscription_payment_success": {
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
        if (referrerProfile) {
          await safeSend(() =>
            sendEmail(
              referrerProfile.email,
              "Nueva comisión de afiliado 💰",
              `<p>Sumaste $${commission.toFixed(2)} en comisión por un nuevo referido.</p>`,
              eventId,
            )
          );
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Webhook handling failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
