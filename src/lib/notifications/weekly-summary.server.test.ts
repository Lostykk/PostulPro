import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkWeeklySummaryQaAllowed, generateWeeklySummaryData } from "./weekly-summary.server";

// Fixture only — not a real user id from any environment.
const QA_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_USER_ID = "11111111-2222-3333-4444-555555555555";

const ENV_KEYS = ["APP_ENV", "PREVIEW_AI_ALLOWED_USER_ID"];
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

describe("checkWeeklySummaryQaAllowed — production (APP_ENV unset)", () => {
  it("is always disabled in production, regardless of user — there is no real cron yet", () => {
    expect(checkWeeklySummaryQaAllowed(QA_USER_ID)).toMatchObject({
      allowed: false,
      status: 503,
      code: "weekly_summary_disabled",
    });
  });
});

describe("checkWeeklySummaryQaAllowed — preview", () => {
  beforeEach(() => {
    process.env.APP_ENV = "preview";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = QA_USER_ID;
  });

  it("allows only the exact allowlisted QA user", () => {
    expect(checkWeeklySummaryQaAllowed(QA_USER_ID)).toEqual({ allowed: true });
  });

  it("rejects any other user with 403", () => {
    expect(checkWeeklySummaryQaAllowed(OTHER_USER_ID)).toMatchObject({
      allowed: false,
      status: 403,
      code: "weekly_summary_restricted",
    });
  });

  it("fails closed when the allowlist itself is unset", () => {
    delete process.env.PREVIEW_AI_ALLOWED_USER_ID;
    expect(checkWeeklySummaryQaAllowed(QA_USER_ID)).toMatchObject({ allowed: false, status: 403 });
  });
});

describe("generateWeeklySummaryData", () => {
  function mockSupabase(rows: { tokens_used: number | null }[]) {
    const eqCalls: [string, unknown][] = [];
    const gteCalls: [string, unknown][] = [];
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return {
              gte: vi.fn((col2: string, val2: unknown) => {
                gteCalls.push([col2, val2]);
                return Promise.resolve({ data: rows, error: null });
              }),
            };
          }),
        })),
      })),
      _eqCalls: eqCalls,
      _gteCalls: gteCalls,
    } as unknown as Parameters<typeof generateWeeklySummaryData>[0] & {
      _eqCalls: typeof eqCalls;
      _gteCalls: typeof gteCalls;
    };
  }

  it("counts real generations and sums real tokens_used for the last 7 days", async () => {
    const supabase = mockSupabase([
      { tokens_used: 100 },
      { tokens_used: 50 },
      { tokens_used: null },
    ]);
    const result = await generateWeeklySummaryData(
      supabase,
      "user-1",
      new Date("2026-07-14T00:00:00Z"),
    );
    expect(result).toEqual({ generations: 3, tokensUsed: 150 });
  });

  it("returns zeroes for a user with no activity", async () => {
    const supabase = mockSupabase([]);
    const result = await generateWeeklySummaryData(supabase, "user-1");
    expect(result).toEqual({ generations: 0, tokensUsed: 0 });
  });

  it("scopes strictly to the requested user id — never a different user's rows", async () => {
    const supabase = mockSupabase([]);
    await generateWeeklySummaryData(supabase, "user-a", new Date("2026-07-14T00:00:00Z"));
    expect((supabase as unknown as { _eqCalls: unknown })._eqCalls).toEqual([
      ["user_id", "user-a"],
    ]);
  });
});
