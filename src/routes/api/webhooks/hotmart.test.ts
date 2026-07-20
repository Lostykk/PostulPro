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
  // Only consulted after a 23505 conflict on the insert above — the
  // route's own lookup of the pre-existing row's processing_status.
  hotmartEventsConflictLookup?: { data: { id: string; processing_status: string } | null; error: { message: string } | null };
  subscriptionLookup?: { data: { user_id: string } | null; error: null | { message: string } };
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
              single: async () => scenario.hotmartEventsInsert ?? { data: { id: "event-row-1" }, error: null },
            }),
          }),
          select: () => ({
            eq: () => ({
              single: async () =>
                scenario.hotmartEventsConflictLookup ?? { data: { id: "event-row-1", processing_status: "processed" }, error: null },
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

function makeRequest(body: string, opts: { hottok?: string | null; contentType?: string; method?: string; header?: string | null } = {}): Request {
  const bodyObj = JSON.parse(body);
  const withHottok = opts.hottok === undefined ? { ...bodyObj, hottok: HOTTOK } : opts.hottok === null ? bodyObj : { ...bodyObj, hottok: opts.hottok };
  const headers: Record<string, string> = { "content-type": opts.contentType ?? "application/json" };
  if (opts.header) headers["x-hotmart-hottok"] = opts.header;
  return new Request("https://preview.example/api/webhooks/hotmart", {
    method: opts.method ?? "POST",
    headers,
    body: JSON.stringify(withHottok),
  });
}

// Flat-shaped bodies — normalize.ts's confirmed graceful-degradation
// fallback path (no top-level `data` object) — deliberately used for most
// of these tests because it is the simplest way to express "a purchase
// for offer X". The buyer domain here (@realcustomer.test) is
// DELIBERATELY NOT one that trips normalize.ts's isLikelyTestPayload
// heuristic (example.com / *.hotmart.com / a "test" product name/ucode)
// — these tests exercise the genuine commercial-processing path, not
// Hotmart's own sandbox "Send test event" isolation (see
// hotmart.nested.test.ts for coverage of the real nested 2.0.0 shape and
// the test-payload isolation behavior itself).
function approvedPurchaseBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    status: "approved",
    transaction: "TXN-1",
    subscriber_code: "SUB-1",
    prod: "8148076",
    off: "w6nw1f3o",
    email: "buyer@realcustomer.test",
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

  it("rejects a missing hottok (neither body nor header)", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { hottok: null }) });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong hottok", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { hottok: "wrong-value" }) });
    expect(res.status).toBe(401);
  });

  it("accepts the hottok via the x-hotmart-hottok header when the body field is absent", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { hottok: null, header: HOTTOK }) });
    expect(res.status).toBe(200);
  });

  it("rejects when the rate limiter denies the request", async () => {
    activeScenario.rateLimit = { data: [{ allowed: false, remaining: 0, reset_at: new Date().toISOString() }], error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(429);
  });

  it("a broken rate limiter (RPC error) fails CLOSED with 503, never a generic 500 — but only for an authenticated caller", async () => {
    activeScenario.rateLimit = { data: null, error: { message: "some internal db detail that should not leak" } };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; result: string };
    expect(body.ok).toBe(false);
    expect(body.result).toBe("failed");
    const text = await handler({ request: makeRequest(approvedPurchaseBody()) }).then((r) => r.text());
    expect(text).not.toContain("some internal db detail");
  });

  it("the rate limiter is never called at all for an unauthenticated request — auth is checked first (Fase C security order)", async () => {
    activeScenario.rateLimit = { data: null, error: { message: "should never be reached" } };
    const res = await handler({ request: makeRequest(approvedPurchaseBody(), { hottok: "wrong-value" }) });
    expect(res.status).toBe(401);
    expect(calls.find((c) => c.rpcName === "claim_webhook_rate_limit")).toBeUndefined();
  });

  it("approved purchase for an existing user resolves by email and calls process_hotmart_event with the resolved plan", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: string };
    expect(body.ok).toBe(true);
    expect(body.result).toBe("processed");

    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    expect(rpcCall).toBeTruthy();
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_user_id).toBe("existing-user-1");
    expect(args.p_plan).toBe("pro");
    expect(args.p_event_type).toBe("purchase_approved");
  });

  it("an approved-status delivery for an already-linked subscription is sent as renewal_approved, not purchase_approved (no duplicate welcome email)", async () => {
    activeScenario.subscriptionLookup = { data: { user_id: "linked-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);

    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_user_id).toBe("linked-user-1");
    expect(args.p_event_type).toBe("renewal_approved");
  });

  it("upgrade PRO -> Business: a new approved offer on the same subscriber_code resolves to the NEW plan (via renewal_approved, same RPC branch as plan_change)", async () => {
    activeScenario.subscriptionLookup = { data: { user_id: "linked-user-1" }, error: null };
    const res = await handler({
      request: makeRequest(approvedPurchaseBody({ off: "zy2exb4h" })), // business_monthly real offer id
    });
    expect(res.status).toBe(200);
    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_event_type).toBe("renewal_approved");
    expect(args.p_plan).toBe("business");
    expect(args.p_credits_limit).toBe(500);
  });

  it("downgrade Business -> PRO: same mechanism, resolves to the lower plan", async () => {
    activeScenario.subscriptionLookup = { data: { user_id: "linked-user-1" }, error: null };
    const res = await handler({
      request: makeRequest(approvedPurchaseBody({ off: "w6nw1f3o" })), // pro_monthly real offer id
    });
    expect(res.status).toBe(200);
    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    const args = rpcCall!.args as Record<string, unknown>;
    expect(args.p_plan).toBe("pro");
    expect(args.p_credits_limit).toBe(100);
  });

  it("compra PRO anual and Business anual resolve their real offers correctly", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const proAnnual = await handler({ request: makeRequest(approvedPurchaseBody({ off: "z7l3u209" })) });
    expect(proAnnual.status).toBe(200);
    let args = calls.find((c) => c.rpcName === "process_hotmart_event")!.args as Record<string, unknown>;
    expect(args).toEqual(expect.objectContaining({ p_plan: "pro", p_billing_interval: "year", p_credits_limit: 100 }));

    calls.length = 0;
    activeScenario.hotmartEventsInsert = undefined;
    const bizAnnual = await handler({
      request: makeRequest(
        JSON.stringify({ status: "approved", transaction: "TXN-BIZ-A", subscriber_code: "SUB-BIZ-A", prod: "8148076", off: "64lrx4be", email: "buyer2@realcustomer.test" }),
      ),
    });
    expect(bizAnnual.status).toBe(200);
    args = calls.find((c) => c.rpcName === "process_hotmart_event")!.args as Record<string, unknown>;
    expect(args).toEqual(expect.objectContaining({ p_plan: "business", p_billing_interval: "year", p_credits_limit: 500 }));
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

  it("a genuine duplicate delivery (ledger row already in a terminal state) responds 'duplicate' without calling the RPC again", async () => {
    activeScenario.hotmartEventsInsert = { data: null, error: { code: "23505", message: "duplicate" } };
    activeScenario.hotmartEventsConflictLookup = { data: { id: "event-row-1", processing_status: "processed" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; result: string; message: string };
    expect(body.ok).toBe(true);
    expect(body.result).toBe("duplicate");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("a redelivery whose prior attempt is stuck in 'failed' is treated as a legitimate retry, not a duplicate", async () => {
    activeScenario.hotmartEventsInsert = { data: null, error: { code: "23505", message: "duplicate" } };
    activeScenario.hotmartEventsConflictLookup = { data: { id: "event-row-1", processing_status: "failed" }, error: null };
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody()) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("processed");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeTruthy();
  });

  it("an unmapped offer_id is held for review (200, result=unmapped_offer) and never calls process_hotmart_event", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ off: "SOME_UNKNOWN_OFFER" })) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("unmapped_offer");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("a cancellation event for an already-linked subscription resolves user_id from the subscription row, never from email", async () => {
    activeScenario.subscriptionLookup = { data: { user_id: "linked-user-1" }, error: null };
    const res = await handler({
      request: makeRequest(
        JSON.stringify({ status: "canceled", subscriber_code: "SUB-1", email: "someone-else@realcustomer.test" }),
      ),
    });
    expect(res.status).toBe(200);
    const rpcCall = calls.find((c) => c.rpcName === "process_hotmart_event");
    expect((rpcCall!.args as Record<string, unknown>).p_user_id).toBe("linked-user-1");
    expect((rpcCall!.args as Record<string, unknown>).p_event_type).toBe("subscription_cancelled");
  });

  it("a lifecycle event referencing an unknown subscription is result=no_action_required, not treated as an error", async () => {
    const res = await handler({
      request: makeRequest(JSON.stringify({ status: "canceled", subscriber_code: "SUB-NEVER-SEEN" })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("no_action_required");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("an ambiguous/in-flight status is ledgered as no_action_required, never triggers a financial action", async () => {
    const res = await handler({
      request: makeRequest(approvedPurchaseBody({ status: "processing_transaction" })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("no_action_required");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("a genuinely unrecognized event/status is result=unsupported, never a guessed financial action", async () => {
    const res = await handler({
      request: makeRequest(approvedPurchaseBody({ status: "some_made_up_status" })),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("unsupported");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  // Currency policy rewritten 2026-07-20 after a real incident (see
  // docs/hotmart-integration-report.md §5): Hotmart legitimately charges
  // international buyers in their local currency for a USD-configured
  // offer. offer_id is the sole authority for which plan to grant —
  // currency differing from the offer's reference currency is recorded
  // for observability, never blocked. Only a structurally malformed
  // currency value or a non-positive/non-finite amount is a hard block.
  it("accepts a legitimate currency different from the offer's reference currency (e.g. ARS/BRL) and still grants the plan", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    for (const currency of ["ARS", "BRL", "EUR", "MXN"]) {
      calls.length = 0;
      activeScenario.hotmartEventsInsert = undefined;
      const res = await handler({ request: makeRequest(approvedPurchaseBody({ currency, transaction: `TXN-${currency}` })) });
      expect(res.status, currency).toBe(200);
      const body = (await res.json()) as { result: string };
      expect(body.result, currency).toBe("processed");
      expect(calls.find((c) => c.rpcName === "process_hotmart_event"), currency).toBeTruthy();
    }
  });

  it("accepts the matching expected currency", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ currency: "USD" })) });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeTruthy();
  });

  it("hard-blocks a structurally malformed currency value (not a real ISO 4217 code), never a false 200", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ currency: "12$" })) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("failed");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("hard-blocks a non-positive amount even with a valid currency and a valid offer", async () => {
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ currency: "USD", full_price: 0 })) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("failed");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("rejects a body over the size limit with 413", async () => {
    const hugeEmail = "a".repeat(200_000);
    const res = await handler({ request: makeRequest(approvedPurchaseBody({ email: hugeEmail })) });
    expect(res.status).toBe(413);
  });

  it("an authenticated but structurally invalid payload is 422, never a false 200", async () => {
    const res = await handler({ request: makeRequest(JSON.stringify({})) });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { ok: boolean; result: string };
    expect(body.ok).toBe(false);
    expect(body.result).toBe("invalid_payload");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("invalid JSON with no valid Hottok header is 401, never 400 — auth is checked before JSON is trusted", async () => {
    const res = await handler({
      request: new Request("https://preview.example/api/webhooks/hotmart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not valid json",
      }),
    });
    expect(res.status).toBe(401);
  });

  it("invalid JSON authenticated via the header IS 400 — the security order is header-auth before JSON parsing", async () => {
    const res = await handler({
      request: new Request("https://preview.example/api/webhooks/hotmart", {
        method: "POST",
        headers: { "content-type": "application/json", "x-hotmart-hottok": HOTTOK },
        body: "{not valid json",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("invalid_payload");
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

describe("POST /api/webhooks/hotmart — real nested (2.0.0) payload shape and test isolation", () => {
  it("a nested payload shaped like a real Hotmart delivery, with a Hotmart-sandbox-style buyer, has zero commercial effect", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const nestedTestPayload = {
      event: "PURCHASE_APPROVED",
      id: "envelope-1",
      creation_date: 1732000000,
      data: {
        product: { id: 8148076, ucode: "test postback2", name: "test postback2" },
        purchase: { transaction: "HP-TEST-1", status: "approved", offer: { code: "w6nw1f3o" }, full_price: { value: 29, currency_value: "USD" } },
        buyer: { email: "buyer@example.com" },
      },
    };
    const res = await handler({ request: makeRequest(JSON.stringify(nestedTestPayload)) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("ignored_test");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeUndefined();
  });

  it("the same nested shape with a real-looking buyer domain is processed normally", async () => {
    activeScenario.usersLookup = { data: { id: "existing-user-1" }, error: null };
    const nestedRealPayload = {
      event: "PURCHASE_APPROVED",
      id: "envelope-2",
      creation_date: 1732000000,
      data: {
        product: { id: 8148076, ucode: "postulpro-pro", name: "PostulPro Pro" },
        purchase: { transaction: "HP-REAL-1", status: "approved", offer: { code: "w6nw1f3o" }, full_price: { value: 29, currency_value: "USD" } },
        buyer: { email: "buyer@realcustomer.test" },
      },
    };
    const res = await handler({ request: makeRequest(JSON.stringify(nestedRealPayload)) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe("processed");
    expect(calls.find((c) => c.rpcName === "process_hotmart_event")).toBeTruthy();
  });
});
