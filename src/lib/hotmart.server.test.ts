import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HOTMART_PRODUCT_ID,
  HOTMART_OFFER_PLAN_MAP,
  HotmartConfigError,
  findMappingByIds,
  resolveOfferId,
  resolveProductId,
  validateHotmartConfig,
} from "@/lib/hotmart.server";

const OVERRIDE_KEYS = [
  "HOTMART_HOTTOK",
  "HOTMART_PRODUCT_ID_OVERRIDE",
  "HOTMART_OFFER_PRO_MONTHLY_OVERRIDE",
  "HOTMART_OFFER_PRO_ANNUAL_OVERRIDE",
  "HOTMART_OFFER_BUSINESS_MONTHLY_OVERRIDE",
  "HOTMART_OFFER_BUSINESS_ANNUAL_OVERRIDE",
];

describe("hotmart.server config", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of OVERRIDE_KEYS) originalEnv[key] = process.env[key];
    for (const key of OVERRIDE_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of OVERRIDE_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("resolves the real hardcoded product id by default (no override needed)", () => {
    expect(resolveProductId()).toBe("8148076");
    expect(resolveProductId()).toBe(HOTMART_PRODUCT_ID);
  });

  it("resolves each real offer id by default", () => {
    expect(resolveOfferId("pro_monthly")).toBe("w6nw1f3o");
    expect(resolveOfferId("pro_annual")).toBe("z7l3u209");
    expect(resolveOfferId("business_monthly")).toBe("zy2exb4h");
    expect(resolveOfferId("business_annual")).toBe("64lrx4be");
  });

  it("validateHotmartConfig reports HOTMART_HOTTOK missing when unset", () => {
    const result = validateHotmartConfig();
    expect(result).toEqual({ ok: false, missing: ["HOTMART_HOTTOK"] });
  });

  it("validateHotmartConfig reports ok once HOTMART_HOTTOK is set", () => {
    process.env.HOTMART_HOTTOK = "test-value";
    expect(validateHotmartConfig()).toEqual({ ok: true, missing: [] });
  });

  it("resolves each real (product_id, offer_id) pair to the correct plan — never by price/name/currency", () => {
    expect(findMappingByIds("8148076", "w6nw1f3o")).toEqual({
      key: "pro_monthly",
      ...HOTMART_OFFER_PLAN_MAP.pro_monthly,
    });
    expect(findMappingByIds("8148076", "z7l3u209")?.key).toBe("pro_annual");
    expect(findMappingByIds("8148076", "zy2exb4h")?.key).toBe("business_monthly");
    expect(findMappingByIds("8148076", "64lrx4be")?.key).toBe("business_annual");
  });

  it("an unrecognized offer_id never resolves, even with the correct real product_id", () => {
    expect(findMappingByIds("8148076", "SOME_UNKNOWN_OFFER")).toBeUndefined();
  });

  it("an unrecognized product_id never resolves, even with a real offer_id", () => {
    expect(findMappingByIds("SOME_OTHER_PRODUCT", "w6nw1f3o")).toBeUndefined();
  });

  it("business_annual matches the real Hotmart price (USD 948) and the existing credits enforcement (500)", () => {
    const match = findMappingByIds("8148076", "64lrx4be");
    expect(match?.expectedPrice).toBe(948);
    expect(match?.creditsLimit).toBe(500);
    expect(match?.plan).toBe("business");
    expect(match?.interval).toBe("year");
  });

  it("pro_monthly matches the real Hotmart price (USD 29) and the existing credits enforcement (100)", () => {
    const match = findMappingByIds("8148076", "w6nw1f3o");
    expect(match?.expectedPrice).toBe(29);
    expect(match?.creditsLimit).toBe(100);
  });

  it("override env vars let a test/sandbox product supersede the real one without editing hotmart-config.ts", () => {
    process.env.HOTMART_PRODUCT_ID_OVERRIDE = "SANDBOX_PRODUCT";
    process.env.HOTMART_OFFER_PRO_MONTHLY_OVERRIDE = "SANDBOX_OFFER";
    expect(resolveProductId()).toBe("SANDBOX_PRODUCT");
    expect(resolveOfferId("pro_monthly")).toBe("SANDBOX_OFFER");
    // The real product id no longer resolves while the override is active.
    expect(findMappingByIds("8148076", "w6nw1f3o")).toBeUndefined();
    expect(findMappingByIds("SANDBOX_PRODUCT", "SANDBOX_OFFER")?.key).toBe("pro_monthly");
  });

  it("HotmartConfigError is exported and is a real Error subclass", () => {
    expect(new HotmartConfigError("x")).toBeInstanceOf(Error);
  });
});
