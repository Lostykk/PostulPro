import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isPreviewEnvironment, checkAiExecutionAllowed } from "@/lib/ai/preview-guard.server";

// Fixture only — not a real user id from any environment.
const QA_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_USER_ID = "11111111-2222-3333-4444-555555555555";

const ENV_KEYS = ["APP_ENV", "AI_GENERATION_ENABLED", "PREVIEW_AI_ALLOWED_USER_ID"];
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

describe("isPreviewEnvironment", () => {
  it("is false when APP_ENV is unset (production's actual state today)", () => {
    expect(isPreviewEnvironment()).toBe(false);
  });
  it("is false for any value other than exactly 'preview'", () => {
    process.env.APP_ENV = "production";
    expect(isPreviewEnvironment()).toBe(false);
    process.env.APP_ENV = "Preview";
    expect(isPreviewEnvironment()).toBe(false);
    process.env.APP_ENV = "preview-staging";
    expect(isPreviewEnvironment()).toBe(false);
  });
  it("is true only for exactly 'preview'", () => {
    process.env.APP_ENV = "preview";
    expect(isPreviewEnvironment()).toBe(true);
  });
});

describe("checkAiExecutionAllowed — production (APP_ENV unset, matches real prod today)", () => {
  it("allows any authenticated user — production behavior is never restricted by this gate", () => {
    expect(checkAiExecutionAllowed(QA_USER_ID)).toEqual({ allowed: true });
    expect(checkAiExecutionAllowed(OTHER_USER_ID)).toEqual({ allowed: true });
    expect(checkAiExecutionAllowed("")).toEqual({ allowed: true });
  });
});

describe("checkAiExecutionAllowed — preview, fully configured", () => {
  beforeEach(() => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = QA_USER_ID;
  });

  it("allows the exact allowlisted QA user", () => {
    expect(checkAiExecutionAllowed(QA_USER_ID)).toEqual({ allowed: true });
  });

  it("rejects any other authenticated user with 403", () => {
    const result = checkAiExecutionAllowed(OTHER_USER_ID);
    expect(result).toEqual({
      allowed: false,
      status: 403,
      code: "ai_restricted_in_preview",
      message: expect.any(String),
    });
  });

  it("is not fooled by a manipulated/spoofed user id that merely resembles the allowed one", () => {
    expect(checkAiExecutionAllowed(QA_USER_ID + "x")).toMatchObject({
      allowed: false,
      status: 403,
    });
    expect(checkAiExecutionAllowed(QA_USER_ID.toUpperCase())).toMatchObject({
      allowed: false,
      status: 403,
    });
    expect(checkAiExecutionAllowed(" " + QA_USER_ID)).toMatchObject({
      allowed: false,
      status: 403,
    });
  });

  it("rejects an empty user id (never treated as a wildcard match)", () => {
    expect(checkAiExecutionAllowed("")).toMatchObject({ allowed: false, status: 403 });
  });
});

describe("checkAiExecutionAllowed — preview, kill switch off or unset", () => {
  beforeEach(() => {
    process.env.APP_ENV = "preview";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = QA_USER_ID;
  });

  it("blocks even the allowlisted QA user when AI_GENERATION_ENABLED is unset (fails closed)", () => {
    const result = checkAiExecutionAllowed(QA_USER_ID);
    expect(result).toEqual({
      allowed: false,
      status: 503,
      code: "ai_disabled_in_preview",
      message: expect.any(String),
    });
  });

  it("blocks when AI_GENERATION_ENABLED is any value other than exactly 'true'", () => {
    process.env.AI_GENERATION_ENABLED = "1";
    expect(checkAiExecutionAllowed(QA_USER_ID)).toMatchObject({ allowed: false, status: 503 });
    process.env.AI_GENERATION_ENABLED = "TRUE";
    expect(checkAiExecutionAllowed(QA_USER_ID)).toMatchObject({ allowed: false, status: 503 });
    process.env.AI_GENERATION_ENABLED = "false";
    expect(checkAiExecutionAllowed(QA_USER_ID)).toMatchObject({ allowed: false, status: 503 });
  });
});

describe("checkAiExecutionAllowed — preview, allowlist not configured (fails closed)", () => {
  it("blocks every user, including a real one, when PREVIEW_AI_ALLOWED_USER_ID is unset", () => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    // PREVIEW_AI_ALLOWED_USER_ID intentionally left unset.
    expect(checkAiExecutionAllowed(QA_USER_ID)).toMatchObject({ allowed: false, status: 403 });
    expect(checkAiExecutionAllowed(OTHER_USER_ID)).toMatchObject({ allowed: false, status: 403 });
  });
});

describe("checkAiExecutionAllowed — admin bypass (second argument)", () => {
  beforeEach(() => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = QA_USER_ID;
  });

  it("allows a non-allowlisted user when isAdmin is true — the QA allowlist is preserved, not replaced", () => {
    expect(checkAiExecutionAllowed(OTHER_USER_ID, true)).toEqual({ allowed: true });
    // The original allowlisted QA user still works too, independent of admin status.
    expect(checkAiExecutionAllowed(QA_USER_ID, false)).toEqual({ allowed: true });
  });

  it("defaults isAdmin to false when omitted — non-allowlisted callers still rejected", () => {
    expect(checkAiExecutionAllowed(OTHER_USER_ID)).toMatchObject({ allowed: false, status: 403 });
  });

  it("still blocks a non-admin, non-allowlisted user even when isAdmin is explicitly false", () => {
    expect(checkAiExecutionAllowed(OTHER_USER_ID, false)).toMatchObject({
      allowed: false,
      status: 403,
      code: "ai_restricted_in_preview",
    });
  });

  it("the kill switch still blocks admins — it is an operational switch, not a per-user restriction", () => {
    process.env.AI_GENERATION_ENABLED = "false";
    expect(checkAiExecutionAllowed(OTHER_USER_ID, true)).toMatchObject({
      allowed: false,
      status: 503,
      code: "ai_disabled_in_preview",
    });
  });

  it("production ignores isAdmin entirely — already unrestricted regardless", () => {
    delete process.env.APP_ENV;
    expect(checkAiExecutionAllowed(OTHER_USER_ID, false)).toEqual({ allowed: true });
    expect(checkAiExecutionAllowed(OTHER_USER_ID, true)).toEqual({ allowed: true });
  });
});
