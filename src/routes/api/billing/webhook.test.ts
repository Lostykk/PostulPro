import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { Route } from "@/routes/api/billing/webhook";
import * as resendModule from "@/lib/resend.server";

const handler = (Route.options.server as { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } })
  .handlers.POST;

const ORIGINAL_ENV = { ...process.env };
const WEBHOOK_SECRET = "whsec_test_secret";

function sign(body: string): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body, "utf8").digest("hex");
}

function makeRequest(body: string, signature: string | null = sign(body)): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-signature"] = signature;
  return new Request("https://preview.example/api/billing/webhook", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.LEMON_SQUEEZY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.BILLING_RPC_SECRET = "rpc-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("POST /api/billing/webhook", () => {
  it("returns 501 without calling fetch when not configured", async () => {
    delete process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await handler({ request: makeRequest(JSON.stringify({ meta: { event_name: "order_created" }, data: { id: "1", type: "orders", attributes: {} } })) });

    expect(res.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature with 400 and never calls the RPC", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ meta: { event_name: "order_created" }, data: { id: "1", type: "orders", attributes: {} } });

    const res = await handler({ request: makeRequest(body, "0".repeat(64)) });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the signature header is missing entirely", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ meta: { event_name: "order_created" }, data: { id: "1", type: "orders", attributes: {} } });

    const res = await handler({ request: makeRequest(body, null) });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("processes a valid subscription_created event and calls the RPC with correct args", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ ok: true, message: "ok", notify_email: "user@example.com", notify_kind: "pro_confirmation", notify_plan: "pro", notify_commission: null }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const sendProConfirmationSpy = vi.spyOn(resendModule, "sendProConfirmationEmail").mockResolvedValue(undefined as never);

    const body = JSON.stringify({
      meta: { event_name: "subscription_created", custom_data: { user_id: "user-1" } },
      data: {
        id: "sub_1",
        type: "subscriptions",
        attributes: {
          customer_id: 111,
          product_id: 222,
          variant_id: 1879841,
          status: "active",
          renews_at: "2026-08-01T00:00:00Z",
          ends_at: null,
          trial_ends_at: null,
          cancelled: false,
          updated_at: "2026-07-01T00:00:00Z",
        },
      },
    });

    const res = await handler({ request: makeRequest(body) });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/process_lemon_squeezy_event");
    const sentBody = JSON.parse(init.body);
    expect(sentBody.p_event_name).toBe("subscription_created");
    expect(sentBody.p_variant_id).toBe("1879841");
    expect(sentBody.p_status).toBe("active");
    expect(sendProConfirmationSpy).toHaveBeenCalledWith("user@example.com", "pro");
  });

  it("treats 'already processed' as success (200) and sends no notification", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ ok: false, message: "already processed", notify_email: null, notify_kind: null, notify_plan: null, notify_commission: null }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(resendModule, "sendProConfirmationEmail").mockResolvedValue(undefined as never);

    const body = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: "user-1" } },
      data: { id: "order_1", type: "orders", attributes: { status: "paid" } },
    });

    const res = await handler({ request: makeRequest(body) });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).toBe("Already processed");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 500 and sends no notification when the RPC call errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "db unavailable",
    });
    vi.stubGlobal("fetch", fetchMock);
    const sendSpy = vi.spyOn(resendModule, "sendProConfirmationEmail").mockResolvedValue(undefined as never);

    const body = JSON.stringify({
      meta: { event_name: "subscription_created", custom_data: { user_id: "user-1" } },
      data: { id: "sub_1", type: "subscriptions", attributes: { customer_id: 1, product_id: 1, variant_id: 1879841, status: "active", renews_at: null, ends_at: null, trial_ends_at: null, cancelled: false, updated_at: null } },
    });

    const res = await handler({ request: makeRequest(body) });

    expect(res.status).toBe(500);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a byte-identical retried delivery hashes to the same event id (idempotency key)", async () => {
    let capturedIds: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string);
      capturedIds.push(parsed.p_event_id);
      return { ok: true, json: async () => [{ ok: true, message: "ok", notify_email: null, notify_kind: null, notify_plan: null, notify_commission: null }] };
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { user_id: "user-1" } },
      data: { id: "order_1", type: "orders", attributes: { status: "paid" } },
    });

    await handler({ request: makeRequest(body) });
    await handler({ request: makeRequest(body) });

    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[0]).toBe(capturedIds[1]);
    expect(capturedIds[0]).toHaveLength(64);
  });
});
