import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression coverage for a real incident: a Google-OAuth Preview account
// (themisterywhite@gmail.com) got rejected by the preview-guard email
// allowlist because auth.getUser()'s top-level `user.email` was empty for
// that account, even though it was fully signed in — the real value lived
// in `user_metadata.email` instead. See
// docs/build-with-ai-stuck-project-incident.md.

let mockUser: Record<string, unknown> | null;
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (_token: string) =>
        Promise.resolve(
          mockUser
            ? { data: { user: mockUser }, error: null }
            : { data: null, error: { message: "invalid" } },
        ),
    },
  })),
}));

const { authenticate, isAuthedCtx } = await import("@/lib/api-auth.server");

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function req() {
  return new Request("https://example.com/api/x", {
    headers: { authorization: "Bearer test-token" },
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  mockUser = null;
});

describe("authenticate — email resolution", () => {
  it("uses the top-level user.email when present", async () => {
    mockUser = baseUser({ email: "top@example.com" });
    const ctx = await authenticate(req());
    if (!isAuthedCtx(ctx)) throw new Error("expected authed ctx");
    expect(ctx.email).toBe("top@example.com");
  });

  it("falls back to user_metadata.email when the top-level field is empty (the actual bug)", async () => {
    mockUser = baseUser({ email: undefined, user_metadata: { email: "meta@example.com" } });
    const ctx = await authenticate(req());
    if (!isAuthedCtx(ctx)) throw new Error("expected authed ctx");
    expect(ctx.email).toBe("meta@example.com");
  });

  it("falls back to the first identity's identity_data.email when both above are empty", async () => {
    mockUser = baseUser({
      email: undefined,
      user_metadata: {},
      identities: [
        {
          id: "i1",
          user_id: "user-1",
          identity_id: "id1",
          provider: "google",
          identity_data: { email: "identity@example.com" },
        },
      ],
    });
    const ctx = await authenticate(req());
    if (!isAuthedCtx(ctx)) throw new Error("expected authed ctx");
    expect(ctx.email).toBe("identity@example.com");
  });

  it("prefers the top-level field over user_metadata/identities when all are present", async () => {
    mockUser = baseUser({
      email: "top@example.com",
      user_metadata: { email: "meta@example.com" },
      identities: [
        {
          id: "i1",
          user_id: "user-1",
          identity_id: "id1",
          provider: "google",
          identity_data: { email: "identity@example.com" },
        },
      ],
    });
    const ctx = await authenticate(req());
    if (!isAuthedCtx(ctx)) throw new Error("expected authed ctx");
    expect(ctx.email).toBe("top@example.com");
  });

  it("resolves to null (never throws) when no source has an email", async () => {
    mockUser = baseUser({ email: undefined, user_metadata: {}, identities: [] });
    const ctx = await authenticate(req());
    if (!isAuthedCtx(ctx)) throw new Error("expected authed ctx");
    expect(ctx.email).toBeNull();
  });

  it("ignores a non-string user_metadata.email rather than trusting it blindly", async () => {
    mockUser = baseUser({ email: undefined, user_metadata: { email: 12345 } });
    const ctx = await authenticate(req());
    if (!isAuthedCtx(ctx)) throw new Error("expected authed ctx");
    expect(ctx.email).toBeNull();
  });
});

describe("authenticate — unauthorized paths unaffected", () => {
  it("still 401s with no Authorization header", async () => {
    const res = await authenticate(new Request("https://example.com/api/x"));
    expect(isAuthedCtx(res)).toBe(false);
    if (!isAuthedCtx(res)) expect(res.status).toBe(401);
  });

  it("still 401s when getUser errors", async () => {
    mockUser = null;
    const res = await authenticate(req());
    expect(isAuthedCtx(res)).toBe(false);
    if (!isAuthedCtx(res)) expect(res.status).toBe(401);
  });
});
