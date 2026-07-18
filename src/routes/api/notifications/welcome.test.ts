import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Route } from "@/routes/api/notifications/welcome";
import * as resendModule from "@/lib/resend.server";

const handler = (
  Route.options.server as { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } }
).handlers.POST;

const ORIGINAL_ENV = { ...process.env };
const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

type UsersFixture = { email: string; name: string | null; onboarding_completed: boolean } | null;

// Routes Supabase JS's real HTTP calls (auth.getUser, from("users").select,
// rpc("claim_notification")) by URL shape, the same fetch-stubbing approach
// already used in routes/api/billing/webhook.test.ts.
function stubSupabaseFetch(opts: { usersRow: UsersFixture; claimResult: boolean | null }) {
  const calls: { path: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : ((input as Request).url ?? String(input)),
      );
      calls.push({ path: url.pathname, method: "GET" });
      if (url.pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: USER_ID, email: "qa@example.test" }), {
          status: 200,
        });
      }
      if (url.pathname.startsWith("/rest/v1/users")) {
        return new Response(JSON.stringify(opts.usersRow ? [opts.usersRow] : []), { status: 200 });
      }
      if (url.pathname === "/rest/v1/rpc/claim_notification") {
        return new Response(JSON.stringify(opts.claimResult), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

function makeRequest(token: string | null = "valid-token"): Request {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  return new Request("https://preview.example/api/notifications/welcome", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.RESEND_API_KEY = "test-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("POST /api/notifications/welcome", () => {
  it("rejects a request with no Bearer token (401)", async () => {
    const res = await handler({ request: makeRequest(null) });
    expect(res.status).toBe(401);
  });

  it("does not send when onboarding is not completed (409)", async () => {
    stubSupabaseFetch({
      usersRow: { email: "qa@example.test", name: "QA", onboarding_completed: false },
      claimResult: true,
    });
    const sendSpy = vi.spyOn(resendModule, "sendWelcomeEmail");
    const res = await handler({ request: makeRequest() });
    expect(res.status).toBe(409);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("sends exactly once when onboarding is completed and the slot is claimed", async () => {
    stubSupabaseFetch({
      usersRow: { email: "qa@example.test", name: "QA", onboarding_completed: true },
      claimResult: true,
    });
    const sendSpy = vi.spyOn(resendModule, "sendWelcomeEmail").mockResolvedValue(undefined);
    const res = await handler({ request: makeRequest() });
    const body = (await res.json()) as { sent: boolean };
    expect(body.sent).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("does not send again once the idempotency slot was already claimed (welcome duplicado)", async () => {
    stubSupabaseFetch({
      usersRow: { email: "qa@example.test", name: "QA", onboarding_completed: true },
      claimResult: false, // someone else already claimed this key
    });
    const sendSpy = vi.spyOn(resendModule, "sendWelcomeEmail");
    const res = await handler({ request: makeRequest() });
    const body = (await res.json()) as { sent: boolean; reason: string };
    expect(body).toEqual({ sent: false, reason: "already_sent" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("reports a delivery failure without throwing (timeout/5xx from Resend)", async () => {
    stubSupabaseFetch({
      usersRow: { email: "qa@example.test", name: "QA", onboarding_completed: true },
      claimResult: true,
    });
    vi.spyOn(resendModule, "sendWelcomeEmail").mockRejectedValue(
      new Error("Resend request timed out"),
    );
    const res = await handler({ request: makeRequest() });
    const body = (await res.json()) as { sent: boolean; reason: string };
    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: false, reason: "delivery_failed" });
  });

  it("handles a nonexistent profile row without crashing (usuario inexistente)", async () => {
    stubSupabaseFetch({ usersRow: null, claimResult: true });
    const res = await handler({ request: makeRequest() });
    expect(res.status).toBe(409);
  });
});
