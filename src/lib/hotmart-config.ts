// Client-safe. Importable from both client components (checkout buttons)
// and server modules (src/lib/hotmart.server.ts) — contains only
// non-secret Hotmart identifiers (product id, offer ids, checkout URLs)
// and the checkout feature flag. Never put HOTMART_HOTTOK or any other
// secret in this file.
//
// Real product/offer identifiers (2026-07-19, copied directly from the
// Hotmart panel by the account owner — see
// docs/hotmart-integration-report.md §2 for the exact values and their
// source). These are NOT secrets — same posture as
// supabase/functions/lemon-squeezy-webhook/index.ts's own hardcoded
// VARIANT_IDS (that file's own comment: "Variant IDs are not secret —
// hardcoded below"). Unlike Lemon Squeezy, Hotmart has no separate Test
// Mode account for this integration (confirmed: this is the one real
// product with real active sales), so there is no meaningful "different
// value per environment" to resolve from env vars anymore — what
// actually differs per environment is HOTMART_HOTTOK (a real secret,
// server-only, see hotmart.server.ts) and HOTMART_CHECKOUT_ENABLED below
// (the feature flag gating whether checkout links / webhook processing
// are live in a given environment).
export type HotmartPlanKey = "pro_monthly" | "pro_annual" | "business_monthly" | "business_annual";

export const HOTMART_PLAN_KEYS: HotmartPlanKey[] = ["pro_monthly", "pro_annual", "business_monthly", "business_annual"];

export const HOTMART_PRODUCT_ID = "8148076";

export type HotmartOfferMapping = {
  plan: "pro" | "business";
  interval: "month" | "year";
  creditsLimit: number;
  expectedPrice: number; // USD, matches src/lib/plans.ts exactly — audited, not authoritative for access
  expectedCurrency: "USD";
  offerId: string;
  // Other real Hotmart-issued offer codes that resolve to this exact same
  // plan/price/interval — never a different offer. Hotmart mints a
  // distinct offer code per checkout-link variant (confirmed 2026-07-20:
  // the coupon-linked checkout for this same monthly plan/price came back
  // with its own new `off=` code, not the original one below), so
  // findMappingByIds must recognize all of them, not just the first one
  // ever configured. Adding a code here never changes price/plan/credits
  // for anyone — it only widens which real Hotmart offer ids resolve to
  // the SAME already-approved grant.
  additionalOfferIds?: string[];
  checkoutUrl: string;
};

// Server-side source of truth for what each offer key grants (server
// import path: hotmart.server.ts's findMappingByIds). Never derive
// plan/credit effects from client-supplied data, price, product name,
// currency, or the checkout URL alone.
//
// expectedPrice cross-checked against src/lib/plans.ts at the time this
// was written: PLANS.pro.monthlyPrice=29 (pro_monthly),
// .yearlyMonthlyPrice=23 * 12 = 276 (pro_annual),
// PLANS.business.monthlyPrice=99 (business_monthly),
// .yearlyMonthlyPrice=79 * 12 = 948 (business_annual). All four matched
// exactly — no discrepancy to report or reconcile.
export const HOTMART_OFFER_PLAN_MAP: Record<HotmartPlanKey, HotmartOfferMapping> = {
  pro_monthly: {
    plan: "pro",
    interval: "month",
    creditsLimit: 100,
    expectedPrice: 29,
    expectedCurrency: "USD",
    offerId: "w6nw1f3o",
    // The POSTULPRO30 coupon's own checkout link for this same plan/price
    // (verified 2026-07-20: $20.30 first month / $29.00 renewal, exactly
    // 30% off, same product) — a distinct Hotmart-issued offer code, not
    // a different offer.
    additionalOfferIds: ["yjo2udb9"],
    checkoutUrl: "https://pay.hotmart.com/E106787841U?off=w6nw1f3o",
  },
  pro_annual: {
    plan: "pro",
    interval: "year",
    creditsLimit: 100,
    expectedPrice: 276,
    expectedCurrency: "USD",
    offerId: "z7l3u209",
    checkoutUrl: "https://pay.hotmart.com/E106787841U?off=z7l3u209",
  },
  business_monthly: {
    plan: "business",
    interval: "month",
    creditsLimit: 500,
    expectedPrice: 99,
    expectedCurrency: "USD",
    offerId: "zy2exb4h",
    // The POSTULPRO30 coupon's own checkout link for this same plan/price
    // (verified 2026-07-20: $69.30 first month / $99.00 renewal, exactly
    // 30% off, same product) — a distinct Hotmart-issued offer code, not
    // a different offer.
    additionalOfferIds: ["oa0kfv5m"],
    checkoutUrl: "https://pay.hotmart.com/E106787841U?off=zy2exb4h",
  },
  business_annual: {
    plan: "business",
    interval: "year",
    creditsLimit: 500,
    expectedPrice: 948,
    expectedCurrency: "USD",
    offerId: "64lrx4be",
    checkoutUrl: "https://pay.hotmart.com/E106787841U?off=64lrx4be",
  },
};

// Whether checkout links should point at the real Hotmart checkout URLs
// in this environment. Mirrors the existing AI_GENERATION_ENABLED /
// APP_ENV pattern already used elsewhere in this project (see
// src/lib/ai/preview-guard.server.ts) rather than inventing a new
// mechanism — VITE_-prefixed so it's readable from the client bundle
// (checkout buttons render client-side), unset/false by default so
// production never shows a live Hotmart checkout button just because
// this code exists in the tree before any deliberate cutover decision.
export function hotmartCheckoutEnabled(): boolean {
  return import.meta.env.VITE_HOTMART_CHECKOUT_ENABLED === "true";
}
