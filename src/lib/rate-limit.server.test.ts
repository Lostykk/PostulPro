import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPlanRateLimitConfig,
  hashIp,
  clientIpFrom,
  rateLimitHeaders,
} from "@/lib/rate-limit.server";

const ENV_KEYS = [
  "PLAN_RATE_LIMIT_WINDOW_SECONDS",
  "PLAN_RATE_LIMIT_MAX_REQUESTS",
  "PLAN_RATE_LIMIT_DAILY_MAX",
  "RATE_LIMIT_PEPPER",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("getPlanRateLimitConfig", () => {
  it("falls back to the documented defaults when no env vars are set", () => {
    const cfg = getPlanRateLimitConfig();
    expect(cfg).toEqual({ windowSeconds: 600, maxRequests: 5, dailyMax: 20 });
  });

  it("reads overrides from environment variables", () => {
    process.env.PLAN_RATE_LIMIT_WINDOW_SECONDS = "120";
    process.env.PLAN_RATE_LIMIT_MAX_REQUESTS = "3";
    process.env.PLAN_RATE_LIMIT_DAILY_MAX = "10";
    const cfg = getPlanRateLimitConfig();
    expect(cfg).toEqual({ windowSeconds: 120, maxRequests: 3, dailyMax: 10 });
  });

  it("ignores garbage/non-positive overrides and falls back to defaults", () => {
    process.env.PLAN_RATE_LIMIT_MAX_REQUESTS = "not-a-number";
    process.env.PLAN_RATE_LIMIT_DAILY_MAX = "-5";
    const cfg = getPlanRateLimitConfig();
    expect(cfg.maxRequests).toBe(5);
    expect(cfg.dailyMax).toBe(20);
  });
});

describe("hashIp", () => {
  it("returns null when there is no pepper configured (fails closed on the signal, not the limiter)", async () => {
    expect(await hashIp("1.2.3.4")).toBeNull();
  });

  it("returns null when there is no IP", async () => {
    process.env.RATE_LIMIT_PEPPER = "test-pepper-value-not-a-real-secret";
    expect(await hashIp(null)).toBeNull();
  });

  it("is deterministic for the same IP + pepper", async () => {
    process.env.RATE_LIMIT_PEPPER = "test-pepper-value-not-a-real-secret";
    const a = await hashIp("1.2.3.4");
    const b = await hashIp("1.2.3.4");
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("never returns the raw IP — output is a hex digest, not the input", async () => {
    process.env.RATE_LIMIT_PEPPER = "test-pepper-value-not-a-real-secret";
    const hash = await hashIp("203.0.113.42");
    expect(hash).not.toContain("203.0.113.42");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different IPs under the same pepper", async () => {
    process.env.RATE_LIMIT_PEPPER = "test-pepper-value-not-a-real-secret";
    const a = await hashIp("1.2.3.4");
    const b = await hashIp("5.6.7.8");
    expect(a).not.toBe(b);
  });

  it("differs for the same IP under different peppers (pepper actually salts the hash)", async () => {
    process.env.RATE_LIMIT_PEPPER = "pepper-one";
    const a = await hashIp("1.2.3.4");
    process.env.RATE_LIMIT_PEPPER = "pepper-two";
    const b = await hashIp("1.2.3.4");
    expect(a).not.toBe(b);
  });
});

describe("clientIpFrom", () => {
  it("prefers cf-connecting-ip (set by Cloudflare at the edge, not client-spoofable)", () => {
    const req = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "1.1.1.1", "x-real-ip": "2.2.2.2" },
    });
    expect(clientIpFrom(req)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when cf-connecting-ip is absent", () => {
    const req = new Request("https://example.com", { headers: { "x-real-ip": "2.2.2.2" } });
    expect(clientIpFrom(req)).toBe("2.2.2.2");
  });

  it("returns null when neither header is present", () => {
    const req = new Request("https://example.com");
    expect(clientIpFrom(req)).toBeNull();
  });
});

describe("rateLimitHeaders", () => {
  it("computes a non-negative Retry-After from a future resetAt", () => {
    const resetAt = new Date(Date.now() + 30_000).toISOString();
    const headers = rateLimitHeaders({ allowed: false, remaining: 0, resetAt, dailyRemaining: 3 });
    const retryAfter = Number(headers["Retry-After"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });

  it("clamps Retry-After to 0 for a resetAt already in the past", () => {
    const resetAt = new Date(Date.now() - 5_000).toISOString();
    const headers = rateLimitHeaders({ allowed: false, remaining: 0, resetAt, dailyRemaining: 3 });
    expect(headers["Retry-After"]).toBe("0");
  });

  it("surfaces remaining and daily-remaining counts for the client to display", () => {
    const headers = rateLimitHeaders({
      allowed: true,
      remaining: 2,
      resetAt: new Date().toISOString(),
      dailyRemaining: 11,
    });
    expect(headers["X-RateLimit-Remaining"]).toBe("2");
    expect(headers["X-RateLimit-Daily-Remaining"]).toBe("11");
  });
});

// The atomic claim-or-reject behavior itself (advisory-lock-serialized
// window/daily counting inside claim_plan_rate_limit) runs in Postgres
// and is intentionally not re-implemented or mocked here — testing it
// meaningfully requires a real database. It was verified directly against
// the linked Supabase project: table + RPC created via migration
// 20260714010000, RLS enabled with zero grants to anon/authenticated
// (confirmed empty grant set), and the RPC's SQL reviewed for the
// per-user pg_advisory_xact_lock that prevents two concurrent requests
// from both reading a stale count and both proceeding.
