import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Route } from "@/routes/api/notifications/weekly-summary-qa";
import * as resendModule from "@/lib/resend.server";

const handler = (
  Route.options.server as { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } }
).handlers.POST;

const ORIGINAL_ENV = { ...process.env };
const QA_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_USER_ID = "11111111-2222-3333-4444-555555555555";

function stubSupabaseFetch(opts: {
  authUserId: string;
  usersRow: { email: string; notify_email: boolean } | null;
  claimResult: boolean | null;
  generationsRows?: { tokens_used: number | null }[];
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : ((input as Request).url ?? String(input)),
      );
      if (url.pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: opts.authUserId, email: "qa@example.test" }), {
          status: 200,
        });
      }
      if (url.pathname.startsWith("/rest/v1/rpc/claim_notification")) {
        return new Response(JSON.stringify(opts.claimResult), { status: 200 });
      }
      if (url.pathname.startsWith("/rest/v1/generations")) {
        return new Response(JSON.stringify(opts.generationsRows ?? []), { status: 200 });
      }
      if (url.pathname.startsWith("/rest/v1/users")) {
        return new Response(JSON.stringify(opts.usersRow ? [opts.usersRow] : []), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

function makeRequest(): Request {
  return new Request("https://preview.example/api/notifications/weekly-summary-qa", {
    method: "POST",
    headers: { authorization: "Bearer valid-token" },
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.RESEND_API_KEY = "test-key";
  process.env.APP_ENV = "preview";
  process.env.PREVIEW_AI_ALLOWED_USER_ID = QA_USER_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("POST /api/notifications/weekly-summary-qa", () => {
  it("is disabled outside preview even for the allowlisted user (no real cron)", async () => {
    delete process.env.APP_ENV;
    stubSupabaseFetch({
      authUserId: QA_USER_ID,
      usersRow: { email: "qa@example.test", notify_email: true },
      claimResult: true,
    });
    const res = await handler({ request: makeRequest() });
    expect(res.status).toBe(503);
  });

  it("rejects a non-allowlisted user even in preview (403)", async () => {
    stubSupabaseFetch({
      authUserId: OTHER_USER_ID,
      usersRow: { email: "other@example.test", notify_email: true },
      claimResult: true,
    });
    const res = await handler({ request: makeRequest() });
    expect(res.status).toBe(403);
  });

  it("sends once for the allowlisted QA user in preview, using only their own rows", async () => {
    stubSupabaseFetch({
      authUserId: QA_USER_ID,
      usersRow: { email: "qa@example.test", notify_email: true },
      claimResult: true,
      generationsRows: [{ tokens_used: 200 }],
    });
    const sendSpy = vi.spyOn(resendModule, "sendWeeklySummaryEmail").mockResolvedValue(undefined);
    const res = await handler({ request: makeRequest() });
    const body = (await res.json()) as {
      sent: boolean;
      stats: { generations: number; tokensUsed: number };
    };
    expect(body.sent).toBe(true);
    expect(body.stats).toEqual({ generations: 1, tokensUsed: 200 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("does not send twice in the same ISO week (weekly summary duplicado)", async () => {
    stubSupabaseFetch({
      authUserId: QA_USER_ID,
      usersRow: { email: "qa@example.test", notify_email: true },
      claimResult: false, // already claimed this week
    });
    const sendSpy = vi.spyOn(resendModule, "sendWeeklySummaryEmail");
    const res = await handler({ request: makeRequest() });
    const body = (await res.json()) as { sent: boolean; reason: string };
    expect(body).toEqual({ sent: false, reason: "already_sent_this_week" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("respects notify_email = false even for the QA account", async () => {
    stubSupabaseFetch({
      authUserId: QA_USER_ID,
      usersRow: { email: "qa@example.test", notify_email: false },
      claimResult: true,
    });
    const sendSpy = vi.spyOn(resendModule, "sendWeeklySummaryEmail");
    const res = await handler({ request: makeRequest() });
    const body = (await res.json()) as { sent: boolean; reason: string };
    expect(body).toEqual({ sent: false, reason: "notifications_opted_out" });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
