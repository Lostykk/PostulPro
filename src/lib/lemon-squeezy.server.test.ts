import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cancelSubscription, verifyWebhookSignature } from "@/lib/lemon-squeezy.server";
import { createHmac } from "node:crypto";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.LEMON_SQUEEZY_API_KEY = "test-api-key";
  process.env.LEMON_SQUEEZY_STORE_ID = "12345";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("cancelSubscription", () => {
  it("sends a DELETE to the correct subscription resource with auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await cancelSubscription("sub_789");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.lemonsqueezy.com/v1/subscriptions/sub_789");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer test-api-key");
  });

  it("throws (never swallows) when Lemon Squeezy returns a non-ok status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "subscription not found",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelSubscription("sub_missing")).rejects.toThrow(/404/);
  });

  it("throws if LEMON_SQUEEZY_API_KEY is not configured, without ever calling fetch", async () => {
    delete process.env.LEMON_SQUEEZY_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelSubscription("sub_789")).rejects.toThrow(/LEMON_SQUEEZY_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_test";

  it("accepts a correctly-signed body", () => {
    const body = JSON.stringify({ meta: { event_name: "order_created" } });
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ meta: { event_name: "order_created" } });
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyWebhookSignature(body + "x", sig, secret)).toBe(false);
  });

  it("rejects when the signature header is missing", () => {
    expect(verifyWebhookSignature("{}", null, secret)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ meta: { event_name: "order_created" } });
    const sig = createHmac("sha256", "wrong-secret").update(body, "utf8").digest("hex");
    expect(verifyWebhookSignature(body, sig, secret)).toBe(false);
  });
});
