import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Route } from "@/routes/api/webhooks/hotmart";

const handler = (
  Route.options.server as { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } }
).handlers.POST;

const ORIGINAL_ENV = { ...process.env };
const HOTTOK = "test-hottok-value";
const RPC_SECRET = "rpc-secret";

type Scenario = {
  hotmartEventsInsert?: { data: { id: string } | null; error: { code?: string; message: string } | null };
  subscriptionLookup?: { data: { user_id: string; plan: string; billing_interval: string } | null; error: null | { message: string } };
  usersLookup?: { data: { id: string } | null; error: null | { message: string } };
  inviteUser?: { data: { user: { id: string } } | null; error: null | { message: string } };
  rateLimit?: { data: Array<{ allowed: boolean; remaining: number; reset_at: string }> | null; error: null | { message: string } };
  processHotmartEvent?: { data: Array<{ ok: boolean; message: string; notify_email: string | null; notify_kind: string | null; notify_plan: string | null }> | null; error: null | { message: string } };
};

const calls: { rpcName: string; args: unknown }[] = [];

function makeFakeSupabase(scenario: Scenario) {
  return {
    from(table: string) {
      if (table === "hotmart_events") {
        return {
          insert: () => ({
            select: () => ({
              single: async () =>
                scenario.hotmartEventsInsert ?? { data: { id: "event-row-1" }, error: null },
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => scenario.subscriptionLookup ?? { data: null, error: null },
              }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => scenario.usersLookup ?? { data: null, error: null },
            }),
          }),
        };
      }
      if (table === "hotmart_pending_links") {
        return { insert: async () => ({ error: null }) };
      }
      throw new Error(`unexpected table in test: ${table}`);
    },
    rpc(name: string, args: unknown) {
      calls.push({ rpcName: name, args });
      if (name === "claim_webhook_rate_limit") {
        return Promise.resolve(scenario.rateLimit ?? { data: [{ allowed: true, remaining: 59, reset_at: new Date().toISOString() }], error: null });
      }
      if (name === "process_hotmart_event") {
        return Promise.resolve(
          scenario.processHotmartEvent ?? {
            data: [{ ok: true, message: "ok", notify_email: null, notify_kind: null, notify_plan: null }],
            error: null,
          },
        );
      }
      throw new Error(`unexpected rpc in test: ${name}`);
    },
    auth: {
      admin: {
        inviteUserByEmail: async () => scenario.inviteUser ?? { data: { user: { id: "new-user-1" } }, error: null },
      },
    },
  };
}

let activeScenario: Scenario = {};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => makeFakeSupabase(activeScenario),
}));

function makeRequest(body: string, opts: { hottok?: string | null; contentType?: string; method?: string } = {}): Request {
  const bodyObj = JSON.parse(body);
  const withHottok = opts.hottok === undefined ? { ...bodyObj, hottok: HOTTOK } : opts.hottok === null ? bodyObj : { ...bodyObj, hottok: opts.hottok };
  return new Request("https://preview.example/api/webhooks/hotmart", {
    method: opts.method ?? "POST",
    headers: { "content-type": opts.contentType ?? "application/json" },
    body: JSON.stringify(withHottok),
  });
}

// Real product/offer ids (see src/lib/hotmart-config.ts) — using them
// directly here, not overrides, is deliberate: these tests exercise the
// actual production mapping, not a synthetic sandbox one.
function approvedPurchaseBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "approved",
    transaction: "TXN-1",
    subscriber_code: "SUB-1",
    prod: "8148076",
    off: "w6nw1f3o",
    email: "Buyer@Example.com ",
    ...overrides,
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  process.env.HOTMART_HOTTOK = HOTTOK;
  process.env.BILLING_RPC_SECRET = RPC_SECRET;
  activeScenario = {};
  calls.length = 0;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("POST /api/webhooks/hotmart", () => {
  it("rejects GET with 405", async () => {
    const getHandler = (Route.options.server as { handlers: { GET: () => Response } }).handlers.GET;
    const res = getHandler();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("returns 501 when secrets are not configured", async () => {
    delete process.env.HOTMART_HOTTOK;
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(501);
  });

  it("resolves via HOTMART_PRODUCT_ID_OVERRIDE / HOTMART_OFFER_*_OVERRIDE when a sandbox product is configured instead", async () => {
    process.env.HOTMART_PRODUCT_ID_OVERRIDE = "SANDBOX_PRODUCT";
    process.env.HOTMART_OFFER_PRO_MONTHLY_OVERRIDE = "SANDBOX_OFFER";
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    // The real ids no longer resolve while the override is active.
    const realIdsRes = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(realIdsRes.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();

    const sandboxRes = await handler({
      request: makeRequest(approvedPurchaseBody({ prod: "SANDBOX_PRODUCT", off: "SANDBOX_OFFER" })),
    });
    expect(sandboxRes.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeTruthy();
  });

  it("rejects an unsupported Content-Type", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { contentType: "text/plain" }) });
    expect(res.status).toBe(400);
  });

  it("rejects a missing hottok", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { hottok: null }) });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong hottok", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { hottok: "wrong-value" }) });
    expect(res.status).toBe(401);
  });

  it("rejects when the rate limiter denies the request", async () => {
    activeScenario.rateLimit = { data: [{ allowed: false, remaining: 0, reset_at: new Date().toISOString() }], error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(429);
  });

  it("approved purchase for an existing user resolves by email and calls process_hotmart_event with the resolved plan", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    expect(rpcCall).toBeTruthy();
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_user_id).toBe("existing-user-1");
    expect(args.p_plan).toBe("pro");
    expect(args.p_event_type).toBe("purchase_approved");
  });

  it("an approved-status delivery for an already-linked subscription is sent as renewal_approved, not purchase_approved (no duplicate welcome email)", async () => {
    activeScenario.subscriptionLookup = { data: { user_id: "linked-user-1", plan: "pro", billing_interval: "month" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);

    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_user_id).toBe("linked-user-1");
    expect(args.p_event_type).toBe("renewal_approved");
  });

  it("forwards creation_date (when present) to the RPC as p_provider_updated_at for the out-of-order guard", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const seconds = 1732000000;
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ creation_date: seconds })) });
    expect(res.status).toBe(200);
    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_provider_updated_at).toBe(new Date(seconds * 1000).toISOString());
  });

  it("approved purchase for a brand-new email invites a new user instead of guessing a password", async () => {
    activeScenario.usersLookup = { data: null, error: null };
    activeScenario.inviteUser = { data: { user: { id: "brand-new-user-1" } }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);

    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_user_id).toBe("brand-new-user-1");
  });

  it("a duplicate delivery (unique_violation on the ledger insert) responds already-processed without calling the RPC", async () => {
    activeScenario.hotmartEventsInsert = { data: null, error: { code: "23505", message: "duplicate" } };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("already processed");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("an unmapped offer_id is ignored (200) and never calls process_hotmart_event", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ off: "SOME_UNKNOWN_OFFER" })) });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("a cancellation event for an already-linked subscription resolves user_id from the subscription row, never from email", async () => {
    activeScenario.subscriptionLookup = { data: { user_id: "linked-user-1", plan: "pro", billing_interval: "month" }, error: null };
    const res = await handler({
      request: makeRequest(
        JSON.stringify({ status: "canceled", subscriber_code: "SUB-1", email: "someone-else@example.com" }),
      ),
    });
    expect(res.status).toBe(200);
    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    expect((rpcCall!.args as Record<string, unknown>).p_user_id).toBe("linked-user-1");
    expect((rpcCall!.args as Record<string, unknown>).p_event_type).toBe("subscription_cancelled");
  });

  it("a lifecycle event referencing an unknown subscription is ignored, not treated as an error", async () => {
    const res = await handler({
      request: makeRequest(JSON.stringify({ status: "canceled", subscriber_code: "SUB-NEVER-SEEN" })),
    });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("an ambiguous/in-flight status is ledgered but never triggers a financial action", async () => {
    const res = await handler({
      request: makeRequest(approvedPurchaseBody({ status: "processing_transaction" })),
    });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("rejects an unexpected currency on an otherwise-mapped offer", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ currency: "BRL" })) });
    expect(res.status).toBe(400);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("accepts the matching expected currency", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ currency: "USD" })) });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeTruthy();
  });

  it("rejects a body over the size limit with 413", async () => {
    const hugeEmail = "a".repeat(200_000);
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ email: hugeEmail })) });
    expect(res.status).toBe(413);
  });

  it("never leaks the configured secret or a raw error in any response body", async () => {
    activeScenario.processHotmartEvent = { data: null, error: { message: "some internal db detail that should not leak" } };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    const text = await res.text();
    expect(text).not.toContain(RPC_SECRET);
    expect(text).not.toContain(HOTTOK);
    expect(text).not.toContain("some internal db detail");
  });
});
