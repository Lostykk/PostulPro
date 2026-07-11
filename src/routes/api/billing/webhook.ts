import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { verifyWebhookSignature } from "@/lib/lemon-squeezy.server";
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

// Structured, secret-free observability for webhook processing. Never
// includes signatures, API keys, or raw request bodies — only identifiers
// and the outcome, so this is safe to ship to Cloudflare's request logs
// (Workers > Observability > Logs must be enabled in the dashboard to
// actually persist/view these).
function logWebhookEvent(fields: {
  event_id?: string;
  event_name?: string;
  provider_subscription_id?: string;
  user_id?: string;
  result: "rejected_signature" | "rejected_config" | "processed" | "already_processed" | "error";
  reason?: string;
  latency_ms: number;
}) {
  console.log(JSON.stringify({ scope: "billing_webhook", ...fields }));
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
  updated_at: string | null;
};

// The subscription-invoice resource sent for subscription_payment_success /
// subscription_payment_failed. `subscription_id` and `total` are the two
// fields this handler depends on, per
// docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object.
type SubscriptionInvoiceAttributes = {
  subscription_id: number | string;
  total: number;
  status: string;
};

type RpcResult = {
  ok: boolean;
  message: string;
  notify_email: string | null;
  notify_kind: "pro_confirmation" | "payment_failed" | "commission" | null;
  notify_plan: "pro" | "business" | null;
  notify_commission: number | null;
};

// Lemon Squeezy webhook. Verifies the raw-body HMAC signature itself, then
// delegates every DB mutation to the process_lemon_squeezy_event() Postgres
// RPC (supabase/migrations — SECURITY DEFINER, owned by postgres, so it can
// bypass RLS the same way existing functions like reserve_credits do).
//
// This Worker deliberately holds no SUPABASE_SERVICE_ROLE_KEY: it calls the
// RPC over PostgREST using only the public anon/publishable key (safe to
// ship in a client bundle) plus BILLING_RPC_SECRET, a secret dedicated to
// this one integration and known only to Cloudflare + the RPC's stored
// SHA-256 hash of it — never persisted in plaintext anywhere.
//
// Idempotency: Lemon Squeezy doesn't hand out a stable per-delivery event id
// in the payload the way Stripe does, so the ledger key is sha256(raw body)
// — a genuine retry/duplicate delivery is byte-identical and hashes the
// same, while any real state change (status, updated_at, etc.) hashes
// differently. The RPC records it in lemon_squeezy_events before acting on
// it (INSERT, unique violation = already processed) inside the same
// transaction as the rest of the event's mutations.

async function callBillingRpc(payload: {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  BILLING_RPC_SECRET: string;
  eventId: string;
  eventName: string;
  userId?: string;
  providerSubscriptionId: string;
  variantId?: string;
  customerId?: string;
  productId?: string;
  status?: string;
  renewsAt?: string | null;
  endsAt?: string | null;
  trialEndsAt?: string | null;
  cancelled?: boolean;
  orderPaid?: boolean;
  invoiceTotal?: number;
  providerUpdatedAt?: string | null;
}): Promise<RpcResult> {
  const res = await fetch(`${payload.SUPABASE_URL}/rest/v1/rpc/process_lemon_squeezy_event`, {
    method: "POST",
    headers: {
      apikey: payload.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${payload.SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_secret: payload.BILLING_RPC_SECRET,
      p_event_id: payload.eventId,
      p_event_name: payload.eventName,
      p_user_id: payload.userId ?? null,
      p_provider_subscription_id: payload.providerSubscriptionId,
      p_variant_id: payload.variantId ?? null,
      p_customer_id: payload.customerId ?? null,
      p_product_id: payload.productId ?? null,
      p_status: payload.status ?? null,
      p_renews_at: payload.renewsAt ?? null,
      p_ends_at: payload.endsAt ?? null,
      p_trial_ends_at: payload.trialEndsAt ?? null,
      p_cancelled: payload.cancelled ?? null,
      p_order_paid: payload.orderPaid ?? null,
      p_invoice_total: payload.invoiceTotal ?? null,
      p_provider_updated_at: payload.providerUpdatedAt ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Billing RPC error (${res.status}): ${body.slice(0, 300)}`);
  }
  const rows = (await res.json()) as RpcResult[];
  const row = rows[0];
  if (!row) throw new Error("Billing RPC returned no rows");
  return row;
}

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        const webhookSecret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
        const rpcSecret = process.env.BILLING_RPC_SECRET;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !webhookSecret || !rpcSecret) {
          logWebhookEvent({ result: "rejected_config", latency_ms: Date.now() - startedAt });
          return new Response("Lemon Squeezy webhook not configured", { status: 501 });
        }

        // Raw body read once, verified before any JSON.parse — re-serializing
        // parsed JSON would change the bytes and break signature comparison.
        const rawBody = await request.text();
        const signature = request.headers.get("x-signature");
        if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
          // Repeated hits here are worth watching — could be a misconfigured
          // retry storm or someone probing the endpoint without the secret.
          logWebhookEvent({ result: "rejected_signature", latency_ms: Date.now() - startedAt });
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
        const userId = payload.meta.custom_data?.user_id;
        const providerSubscriptionId = payload.data.id;

        let rpcArgs: Parameters<typeof callBillingRpc>[0] = {
          SUPABASE_URL,
          SUPABASE_ANON_KEY,
          BILLING_RPC_SECRET: rpcSecret,
          eventId,
          eventName,
          userId,
          providerSubscriptionId,
        };

        switch (eventName) {
          case "order_created": {
            const order = payload.data.attributes as OrderAttributes;
            rpcArgs.orderPaid = order.status === "paid";
            rpcArgs.variantId = order.first_order_item ? String(order.first_order_item.variant_id) : undefined;
            break;
          }
          case "subscription_created":
          case "subscription_updated":
          case "subscription_cancelled":
          case "subscription_resumed":
          case "subscription_paused":
          case "subscription_unpaused": {
            const sub = payload.data.attributes as RemoteSubscriptionAttributes;
            rpcArgs = {
              ...rpcArgs,
              variantId: String(sub.variant_id),
              customerId: String(sub.customer_id),
              productId: String(sub.product_id),
              status: sub.status,
              renewsAt: sub.renews_at,
              endsAt: sub.ends_at,
              trialEndsAt: sub.trial_ends_at,
              cancelled: sub.cancelled ?? false,
              providerUpdatedAt: sub.updated_at,
            };
            break;
          }
          case "subscription_expired": {
            const sub = payload.data.attributes as RemoteSubscriptionAttributes;
            rpcArgs.status = sub.status;
            rpcArgs.providerUpdatedAt = sub.updated_at;
            break;
          }
          case "subscription_payment_success":
          case "subscription_payment_failed": {
            const invoice = payload.data.attributes as SubscriptionInvoiceAttributes;
            rpcArgs.providerSubscriptionId = String(invoice.subscription_id);
            rpcArgs.invoiceTotal = invoice.total;
            break;
          }
          default:
            break;
        }

        const logBase = {
          event_id: eventId,
          event_name: eventName,
          provider_subscription_id: providerSubscriptionId,
          user_id: userId,
          latency_ms: 0,
        };

        let result: RpcResult;
        try {
          result = await callBillingRpc(rpcArgs);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Webhook handling failed";
          logWebhookEvent({ ...logBase, result: "error", reason, latency_ms: Date.now() - startedAt });
          // Internal detail (DB/RPC error text) stays in our own logs only —
          // Lemon Squeezy just needs a non-2xx to know to retry.
          return new Response("Webhook handling failed", { status: 500 });
        }

        if (!result.ok) {
          if (result.message === "already processed") {
            logWebhookEvent({ ...logBase, result: "already_processed", latency_ms: Date.now() - startedAt });
            return new Response("Already processed", { status: 200 });
          }
          logWebhookEvent({ ...logBase, result: "error", reason: result.message, latency_ms: Date.now() - startedAt });
          return new Response("Webhook handling failed", { status: 500 });
        }

        logWebhookEvent({ ...logBase, result: "processed", latency_ms: Date.now() - startedAt });

        if (result.notify_email && result.notify_kind) {
          switch (result.notify_kind) {
            case "pro_confirmation":
              if (result.notify_plan) {
                await safeSend(() => sendProConfirmationEmail(result.notify_email as string, result.notify_plan as "pro" | "business"));
              }
              break;
            case "payment_failed":
              await safeSend(() => sendPaymentFailedEmail(result.notify_email as string, eventId));
              break;
            case "commission":
              if (result.notify_commission !== null) {
                await safeSend(() => sendNewCommissionEmail(result.notify_email as string, result.notify_commission as number));
              }
              break;
          }
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
