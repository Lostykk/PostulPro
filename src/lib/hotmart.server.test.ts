import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HOTMART_OFFER_ENV_KEYS,
  HOTMART_PRODUCT_ID_ENV_KEY,
  HotmartConfigError,
  findMappingByIds,
  resolveOfferId,
  resolveProductId,
  validateHotmartConfig,
} from "@/lib/hotmart.server";

const ENV_KEYS = [HOTMART_PRODUCT_ID_ENV_KEY, ...Object.values(HOTMART_OFFER_ENV_KEYS)];

function clearHotmartEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("hotmart.server config", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    clearHotmartEnv();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("validateHotmartConfig reports every missing var when unconfigured", () => {
    const result = validateHotmartConfig();
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([HOTMART_PRODUCT_ID_ENV_KEY, ...Object.values(HOTMART_OFFER_ENV_KEYS)]));
  });

  it("resolveProductId throws HotmartConfigError with no placeholder/invented value", () => {
    expect(() => resolveProductId()).toThrow(HotmartConfigError);
  });

  it("resolveOfferId throws for each plan key when unconfigured", () => {
    expect(() => resolveOfferId("pro_monthly")).toThrow(HotmartConfigError);
    expect(() => resolveOfferId("business_annual")).toThrow(HotmartConfigError);
  });

  it("once configured, validateHotmartConfig reports ok and resolves match by ids only — never by price/name/currency", () => {
    process.env[HOTMART_PRODUCT_ID_ENV_KEY] = "PRODUCT_TEST_1";
    process.env[HOTMART_OFFER_ENV_KEYS.pro_monthly] = "OFFER_TEST_PRO_M";
    process.env[HOTMART_OFFER_ENV_KEYS.pro_annual] = "OFFER_TEST_PRO_A";
    process.env[HOTMART_OFFER_ENV_KEYS.business_monthly] = "OFFER_TEST_BIZ_M";
    process.env[HOTMART_OFFER_ENV_KEYS.business_annual] = "OFFER_TEST_BIZ_A";

    expect(validateHotmartConfig()).toEqual({ ok: true, missing: [] });
    expect(resolveProductId()).toBe("PRODUCT_TEST_1");
    expect(resolveOfferId("business_monthly")).toBe("OFFER_TEST_BIZ_M");

    const match = findMappingByIds("PRODUCT_TEST_1", "OFFER_TEST_PRO_A");
    expect(match).toEqual({ key: "pro_annual", plan: "pro", interval: "year", creditsLimit: 100, expectedCurrency: "USD" });
  });

  it("an unrecognized offer_id never resolves, even with the correct product_id", () => {
    process.env[HOTMART_PRODUCT_ID_ENV_KEY] = "PRODUCT_TEST_1";
    process.env[HOTMART_OFFER_ENV_KEYS.pro_monthly] = "OFFER_TEST_PRO_M";
    expect(findMappingByIds("PRODUCT_TEST_1", "SOME_UNKNOWN_OFFER")).toBeUndefined();
  });

  it("an unrecognized product_id never resolves, even with a valid-looking offer_id", () => {
    process.env[HOTMART_PRODUCT_ID_ENV_KEY] = "PRODUCT_TEST_1";
    process.env[HOTMART_OFFER_ENV_KEYS.pro_monthly] = "OFFER_TEST_PRO_M";
    expect(findMappingByIds("SOME_OTHER_PRODUCT", "OFFER_TEST_PRO_M")).toBeUndefined();
  });

  it("business plan credits/interval mapping matches the existing Lemon Squeezy enforcement numbers exactly", () => {
    process.env[HOTMART_PRODUCT_ID_ENV_KEY] = "P";
    process.env[HOTMART_OFFER_ENV_KEYS.business_annual] = "O";
    const match = findMappingByIds("P", "O");
    // pro=100, business=500 — see supabase/migrations/20260712000000_refund_events.sql:192
    expect(match?.creditsLimit).toBe(500);
    expect(match?.plan).toBe("business");
    expect(match?.interval).toBe("year");
  });
});
