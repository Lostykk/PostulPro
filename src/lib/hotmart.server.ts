// Server-only. Never import this from a route file or component that ships
// to the client bundle — only from other *.server.ts modules or server
// route handlers (src/routes/api/**). Mirrors src/lib/lemon-squeezy.server.ts
// in shape (VARIANT_ENV_KEYS / VARIANT_PLAN_MAP -> OFFER_ENV_KEYS /
// OFFER_PLAN_MAP), which is the single source of truth for what each
// Lemon Squeezy variant grants — this file is the equivalent single source
// of truth for what each Hotmart offer grants. Plan pricing/marketing copy
// itself lives only in src/lib/plans.ts (audited, not modified, by this
// integration) — this file maps *provider identifiers* to the same real
// plan/credits enforcement numbers process_lemon_squeezy_event already
// uses (pro=100, business=500 credits_limit — see
// supabase/migrations/20260712000000_refund_events.sql:192 — deliberately
// matching the existing enforced numbers, not the marketing copy in
// plans.ts's `features` strings, so a Hotmart upgrade behaves identically
// to a Lemon Squeezy upgrade for the same plan).
//
// Hotmart product_id / offer_id values are NEVER hardcoded here — every
// PLACEHOLDER_* constant below throws at startup validation time if used
// unconfigured, per Fase D's explicit "no invented identifiers" rule. Real
// values come from environment variables set in Cloudflare (preview and
// production configured with DIFFERENT values for the same variable
// names — same separation pattern LEMON_SQUEEZY_VARIANT_* already uses:
// preview holds Hotmart's own test/simulated product+offer, production
// holds the real live ones).

export type HotmartPlanKey = "pro_monthly" | "pro_annual" | "business_monthly" | "business_annual";

const ALL_PLAN_KEYS: HotmartPlanKey[] = ["pro_monthly", "pro_annual", "business_monthly", "business_annual"];

// Hotmart's model (per Fase B research — see
// docs/hotmart-integration-report.md §B) is a single "product" (the
// PostulPro Club/course entry) with multiple "offers" (one per price
// point). Product id is configured once; each plan key maps to its own
// offer id. If a future real Hotmart account instead uses one distinct
// product per plan tier, HOTMART_PRODUCT_ID_ENV_KEYS below (currently all
// pointing at the same env var) can be given per-key overrides without
// changing any caller of resolveOffer()/findMappingByIds().
export const HOTMART_PRODUCT_ID_ENV_KEY = "HOTMART_PRODUCT_ID";

export const HOTMART_OFFER_ENV_KEYS: Record<HotmartPlanKey, string> = {
  pro_monthly: "HOTMART_OFFER_PRO_MONTHLY",
  pro_annual: "HOTMART_OFFER_PRO_ANNUAL",
  business_monthly: "HOTMART_OFFER_BUSINESS_MONTHLY",
  business_annual: "HOTMART_OFFER_BUSINESS_ANNUAL",
};

export type HotmartOfferMapping = {
  plan: "pro" | "business";
  interval: "month" | "year";
  creditsLimit: number;
  // Validated against the webhook payload's currency field, never used to
  // *infer* which plan a purchase grants — a currency mismatch is logged
  // and the event is held for admin review (see hotmart-webhook-handler),
  // never silently accepted or silently rejected-as-fraud.
  expectedCurrency: "USD";
};

// Server-side source of truth for what each offer key grants. Never derive
// plan/credit effects from client-supplied data, price, product name, or
// currency alone — only from this allowlist, keyed by our own internal
// plan key, itself resolved only from Hotmart's product_id + offer_id.
export const HOTMART_OFFER_PLAN_MAP: Record<HotmartPlanKey, HotmartOfferMapping> = {
  pro_monthly: { plan: "pro", interval: "month", creditsLimit: 100, expectedCurrency: "USD" },
  pro_annual: { plan: "pro", interval: "year", creditsLimit: 100, expectedCurrency: "USD" },
  business_monthly: { plan: "business", interval: "month", creditsLimit: 500, expectedCurrency: "USD" },
  business_annual: { plan: "business", interval: "year", creditsLimit: 500, expectedCurrency: "USD" },
};

export class HotmartConfigError extends Error {}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function resolveProductId(): string {
  const id = readEnv(HOTMART_PRODUCT_ID_ENV_KEY);
  if (!id) {
    throw new HotmartConfigError(
      `${HOTMART_PRODUCT_ID_ENV_KEY} is not configured — copy the real product id from the Hotmart panel and set this env var (see docs/hotmart-integration-report.md §manual actions).`,
    );
  }
  return id;
}

export function resolveOfferId(key: HotmartPlanKey): string {
  const envName = HOTMART_OFFER_ENV_KEYS[key];
  const id = readEnv(envName);
  if (!id) {
    throw new HotmartConfigError(`${envName} is not configured — create the offer in Hotmart and set this env var.`);
  }
  return id;
}

// Reverse lookup used by the webhook handler: Hotmart's (product_id,
// offer_id) pair, as sent in the payload, back to our internal plan key +
// mapping. Only offers present in HOTMART_OFFER_ENV_KEYS *and* whose
// configured value matches the incoming offer_id resolve — an
// unrecognized product/offer id is never trusted, never guessed from
// price/name/currency, and the caller must treat "undefined" as "ignore
// this event, do not activate anything" (see Fase E §16).
export function findMappingByIds(productId: string, offerId: string): (HotmartOfferMapping & { key: HotmartPlanKey }) | undefined {
  let configuredProductId: string;
  try {
    configuredProductId = resolveProductId();
  } catch {
    return undefined;
  }
  if (productId !== configuredProductId) return undefined;

  for (const key of ALL_PLAN_KEYS) {
    const envName = HOTMART_OFFER_ENV_KEYS[key];
    if (readEnv(envName) === offerId) {
      return { key, ...HOTMART_OFFER_PLAN_MAP[key] };
    }
  }
  return undefined;
}

// Startup validation: call once (e.g. from the webhook route's config
// check, same pattern the existing webhook.ts uses for its own required
// env vars) to fail fast and loud rather than silently ignore every real
// event because of a typo'd env var name. Returns the list of missing
// var names rather than throwing, so callers can decide whether an
// incomplete config is fatal (production) or merely "not live yet"
// (preview, before real Hotmart credentials exist).
export function validateHotmartConfig(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!readEnv(HOTMART_PRODUCT_ID_ENV_KEY)) missing.push(HOTMART_PRODUCT_ID_ENV_KEY);
  for (const key of ALL_PLAN_KEYS) {
    const envName = HOTMART_OFFER_ENV_KEYS[key];
    if (!readEnv(envName)) missing.push(envName);
  }
  return { ok: missing.length === 0, missing };
}
