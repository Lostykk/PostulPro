import Stripe from "stripe";

// Server-only. Never import this from a route file or component that ships
// to the client bundle — only from other *.server.ts modules or server
// route handlers (src/routes/api/**).
//
// Price IDs are NOT hardcoded here: `price_pro_monthly` etc. are logical
// config keys. The real Stripe price IDs must come from env vars set in the
// hosting platform once they exist in Stripe (test mode first).
export const PRICE_ENV_KEYS = {
  pro_monthly: "STRIPE_PRICE_PRO_MONTHLY",
  pro_annual: "STRIPE_PRICE_PRO_ANNUAL",
  business_monthly: "STRIPE_PRICE_BUSINESS_MONTHLY",
  business_annual: "STRIPE_PRICE_BUSINESS_ANNUAL",
  credits_100: "STRIPE_PRICE_CREDITS_100",
} as const;

export type PriceKey = keyof typeof PRICE_ENV_KEYS;

export function resolvePriceId(key: PriceKey): string {
  const envName = PRICE_ENV_KEYS[key];
  const id = process.env[envName];
  if (!id) {
    throw new Error(`${envName} is not configured — create the price in Stripe and set this env var.`);
  }
  return id;
}

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }
  _stripe = new Stripe(key);
  return _stripe;
}
