// Server-only. Never import this from a route file or component that ships
// to the client bundle — only from other *.server.ts modules or server
// route handlers (src/routes/api/**). Client-safe Hotmart identifiers
// (product/offer ids, checkout URLs, the checkout flag) live in
// src/lib/hotmart-config.ts instead, importable from both sides — this
// file re-exports that data for server callers and adds the genuinely
// server-only pieces: resolving overrides from process.env and validating
// that HOTMART_HOTTOK (a real secret) is configured.

import {
  HOTMART_OFFER_PLAN_MAP,
  HOTMART_PRODUCT_ID,
  HOTMART_PLAN_KEYS,
  type HotmartOfferMapping,
  type HotmartPlanKey,
} from "@/lib/hotmart-config";

export type { HotmartPlanKey, HotmartOfferMapping };
export { HOTMART_PRODUCT_ID, HOTMART_OFFER_PLAN_MAP };

export class HotmartConfigError extends Error {}

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

// Override hooks (not the primary path) for a future sandbox product, and
// so tests can substitute a different product/offer set without touching
// hotmart-config.ts — see hotmart.server.test.ts. Fall back to the real
// hardcoded values in hotmart-config.ts when unset, which is the normal
// case in every environment today (Hotmart has no separate Test Mode
// account for this integration — confirmed in Fase B research).
export function resolveProductId(): string {
  return readEnv("HOTMART_PRODUCT_ID_OVERRIDE") ?? HOTMART_PRODUCT_ID;
}

export function resolveOfferId(key: HotmartPlanKey): string {
  const overrideEnvName = `HOTMART_OFFER_${key.toUpperCase()}_OVERRIDE`;
  return readEnv(overrideEnvName) ?? HOTMART_OFFER_PLAN_MAP[key].offerId;
}

// Reverse lookup used by the webhook handler: Hotmart's (product_id,
// offer_id) pair, as sent in the payload, back to our internal plan key +
// mapping. An unrecognized product/offer id is never trusted, never
// guessed from price/name/currency/URL, and the caller must treat
// "undefined" as "ignore this event, do not activate anything" (see the
// webhook route).
export function findMappingByIds(productId: string, offerId: string): (HotmartOfferMapping & { key: HotmartPlanKey }) | undefined {
  if (productId !== resolveProductId()) return undefined;

  for (const key of HOTMART_PLAN_KEYS) {
    if (resolveOfferId(key) === offerId) {
      return { key, ...HOTMART_OFFER_PLAN_MAP[key] };
    }
  }
  return undefined;
}

// Startup validation: call once (e.g. from the webhook route's config
// check, same pattern the existing webhook.ts uses for its own required
// env vars) to fail fast and loud rather than silently ignore every real
// event because of a misconfiguration. Only HOTMART_HOTTOK is genuinely
// "missing until configured" now that product/offer ids are hardcoded
// real values — kept as a named list (not a bare boolean) so the failure
// mode stays as explicit as it was before.
export function validateHotmartConfig(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!readEnv("HOTMART_HOTTOK")) missing.push("HOTMART_HOTTOK");
  return { ok: missing.length === 0, missing };
}
