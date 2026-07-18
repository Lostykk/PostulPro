import { createHmac, timingSafeEqual } from "node:crypto";

// Server-only. Never import this from a route file or component that ships
// to the client bundle — only from other *.server.ts modules or server
// route handlers (src/routes/api/**).
//
// This talks to the Lemon Squeezy REST API directly (JSON:API format)
// instead of depending on the official SDK, so every request/response shape
// used here is pinned to what's documented at docs.lemonsqueezy.com rather
// than to an SDK version's inferred types.

const API_BASE = "https://api.lemonsqueezy.com/v1";

// Variant IDs are NOT hardcoded here: these are logical config keys. The
// real Lemon Squeezy variant ids must come from env vars set in the hosting
// platform once the store/products exist in Lemon Squeezy (Test Mode first).
export const VARIANT_ENV_KEYS = {
  pro_monthly: "LEMON_SQUEEZY_VARIANT_PRO_MONTHLY",
  pro_annual: "LEMON_SQUEEZY_VARIANT_PRO_ANNUAL",
  business_monthly: "LEMON_SQUEEZY_VARIANT_BUSINESS_MONTHLY",
  business_annual: "LEMON_SQUEEZY_VARIANT_BUSINESS_ANNUAL",
  credits_100: "LEMON_SQUEEZY_VARIANT_CREDITS_100",
} as const;

export type VariantKey = keyof typeof VARIANT_ENV_KEYS;

export type VariantMapping =
  | { kind: "subscription"; plan: "pro" | "business"; interval: "month" | "year" }
  | { kind: "credits"; amount: number };

// Server-side source of truth for what each variant key grants. Never derive
// plan/credit effects from client-supplied data, prices, or product names —
// only from this allowlist, keyed by our own internal variant key.
export const VARIANT_PLAN_MAP: Record<VariantKey, VariantMapping> = {
  pro_monthly: { kind: "subscription", plan: "pro", interval: "month" },
  pro_annual: { kind: "subscription", plan: "pro", interval: "year" },
  business_monthly: { kind: "subscription", plan: "business", interval: "month" },
  business_annual: { kind: "subscription", plan: "business", interval: "year" },
  credits_100: { kind: "credits", amount: 100 },
};

export function resolveVariantId(key: VariantKey): string {
  const envName = VARIANT_ENV_KEYS[key];
  const id = process.env[envName];
  if (!id) {
    throw new Error(`${envName} is not configured — create the variant in Lemon Squeezy and set this env var.`);
  }
  return id;
}

// Reverse lookup used by the webhook: a Lemon Squeezy variant id (as sent in
// the payload) back to our internal variant key + mapping. Only variants
// present in VARIANT_ENV_KEYS (i.e. explicitly configured by us) resolve —
// an unrecognized variant id is simply ignored, never trusted.
export function findMappingByVariantId(variantId: string): VariantMapping | undefined {
  for (const key of Object.keys(VARIANT_ENV_KEYS) as VariantKey[]) {
    const envName = VARIANT_ENV_KEYS[key];
    if (process.env[envName] === variantId) return VARIANT_PLAN_MAP[key];
  }
  return undefined;
}

function getApiKey(): string {
  const key = process.env.LEMON_SQUEEZY_API_KEY;
  if (!key) throw new Error("LEMON_SQUEEZY_API_KEY not configured");
  return key;
}

function getStoreId(): string {
  const id = process.env.LEMON_SQUEEZY_STORE_ID;
  if (!id) throw new Error("LEMON_SQUEEZY_STORE_ID not configured");
  return id;
}

async function lsFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${getApiKey()}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lemon Squeezy API error (${res.status}): ${body.slice(0, 500)}`);
  }
  return res.json();
}

// Creates a Checkout for the given variant, attributing it to the
// authenticated Supabase user via checkout_data.custom (echoed back
// verbatim in the webhook payload's meta.custom_data) — this is how the
// webhook links a paid order/subscription back to a user_id, and it is
// never trusted if supplied directly by the client at webhook time.
export async function createCheckout(opts: {
  variantId: string;
  userId: string;
  email: string;
  redirectUrl: string;
}): Promise<string> {
  const body = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: {
          email: opts.email,
          custom: { user_id: opts.userId },
        },
        product_options: {
          redirect_url: opts.redirectUrl,
        },
      },
      relationships: {
        store: { data: { type: "stores", id: getStoreId() } },
        variant: { data: { type: "variants", id: opts.variantId } },
      },
    },
  };
  const json = (await lsFetch("/checkouts", { method: "POST", body: JSON.stringify(body) })) as {
    data?: { attributes?: { url?: string } };
  };
  const url = json.data?.attributes?.url;
  if (!url) throw new Error("Lemon Squeezy did not return a checkout URL");
  return url;
}

export type RemoteSubscription = {
  id: string;
  attributes: {
    customer_id: number;
    product_id: number;
    variant_id: number;
    status: string;
    renews_at: string | null;
    ends_at: string | null;
    trial_ends_at: string | null;
    cancelled: boolean;
    urls: { customer_portal: string | null; update_payment_method: string | null };
  };
};

// Subscription resources carry pre-signed, time-limited portal URLs directly
// on the resource (valid ~24h) — there is no separate "create a portal
// session" call like Stripe's. Re-fetch on every request so the URL is
// always fresh.
export async function getSubscription(providerSubscriptionId: string): Promise<RemoteSubscription> {
  const json = (await lsFetch(`/subscriptions/${providerSubscriptionId}`)) as { data?: RemoteSubscription };
  if (!json.data) throw new Error("Lemon Squeezy subscription not found");
  return json.data;
}

// Cancels a subscription at Lemon Squeezy (DELETE /v1/subscriptions/{id}).
// Per Lemon Squeezy's API this cancels at the end of the current billing
// period (status -> 'cancelled', cancelled: true, ends_at set) rather than
// an immediate/prorated stop — the same behavior as a user cancelling from
// the customer portal. Callers that need to guarantee no further charges
// before deleting local state (e.g. account deletion) must call this first
// and must not proceed with local deletion if it throws.
export async function cancelSubscription(providerSubscriptionId: string): Promise<void> {
  await lsFetch(`/subscriptions/${providerSubscriptionId}`, { method: "DELETE" });
}

// Verifies the raw request body against the X-Signature header using the
// signing secret, per Lemon Squeezy's documented mechanism: HMAC-SHA256 hex
// digest of the raw body, compared with a constant-time comparison. Must be
// called with the untouched raw body string — re-serializing parsed JSON
// before verifying would change the bytes and break the signature.
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
