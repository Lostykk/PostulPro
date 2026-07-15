import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Persistent, cross-instance rate limiting for plan generation. Backed by
// claim_plan_rate_limit (SECURITY DEFINER RPC, see
// supabase/migrations/20260714010000_plan_rate_limiting.sql) — auth.uid()
// is the authoritative identity, never something the client supplies.
// IP is hashed (HMAC-SHA256 with a server-only pepper) before it ever
// leaves this file; the raw address is never logged or stored.

const DEFAULT_WINDOW_SECONDS = 600;
const DEFAULT_MAX_REQUESTS = 5;
const DEFAULT_DAILY_MAX = 20;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPlanRateLimitConfig() {
  return {
    windowSeconds: readIntEnv("PLAN_RATE_LIMIT_WINDOW_SECONDS", DEFAULT_WINDOW_SECONDS),
    maxRequests: readIntEnv("PLAN_RATE_LIMIT_MAX_REQUESTS", DEFAULT_MAX_REQUESTS),
    dailyMax: readIntEnv("PLAN_RATE_LIMIT_DAILY_MAX", DEFAULT_DAILY_MAX),
  };
}

// HMAC-SHA256(ip, pepper) via WebCrypto (available in the Workers runtime
// and in Node >=18, no extra dependency). Returns null if the pepper
// isn't configured or no IP was resolved — the RPC treats a null ip_hash
// as "no complementary signal", never as a bypass of the per-user limit.
export async function hashIp(ip: string | null): Promise<string | null> {
  const pepper = process.env.RATE_LIMIT_PEPPER;
  if (!ip || !pepper) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function clientIpFrom(request: Request): string | null {
  // Cloudflare Workers set this automatically; not spoofable by the
  // client since Cloudflare overwrites any client-supplied copy at the
  // edge before the request reaches the Worker.
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip");
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  dailyRemaining: number;
};

export async function claimPlanRateLimit(
  supabase: SupabaseClient<Database>,
  request: Request,
): Promise<RateLimitResult> {
  const config = getPlanRateLimitConfig();
  const ipHash = await hashIp(clientIpFrom(request));

  const { data, error } = await supabase.rpc("claim_plan_rate_limit", {
    // Generated RPC arg type is non-nullable `string` even though the SQL
    // function defaults this param to NULL — passing `undefined` (dropped
    // by JSON.stringify) lets Postgres apply that default unchanged; see
    // hashIp() above for why null/no-signal must never become a real bucket.
    p_ip_hash: (ipHash ?? undefined) as string,
    p_window_seconds: config.windowSeconds,
    p_max_requests: config.maxRequests,
    p_daily_max: config.dailyMax,
  });

  if (error || !data?.[0]) {
    // Fail closed on an unexpected RPC error — never silently allow
    // unlimited generation just because the limiter itself errored.
    throw new Error("rate_limit_unavailable");
  }
  const row = data[0];
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: row.reset_at,
    dailyRemaining: row.daily_remaining,
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000),
  );
  return {
    "Retry-After": String(retryAfterSeconds),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": result.resetAt,
    "X-RateLimit-Daily-Remaining": String(result.dailyRemaining),
  };
}
