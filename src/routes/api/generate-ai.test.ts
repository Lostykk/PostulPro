import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as callModelModule from "@/lib/ai/call-model.server";

// generate-ai.ts builds its own Supabase client via createClient(...) inside
// the handler (there's no dependency-injection point), so the only way to
// unit-test it without a real network call is to mock the module itself and
// hand back a controllable stub — the same shape of mock executor.server's
// test file uses for the RPC/table surface runProjectStep touches.
let mockSupabase: ReturnType<typeof createMockSupabase>;
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabase),
}));
vi.mock("@/lib/notifications/low-credits.server", () => ({
  maybeSendLowCreditsEmail: vi.fn().mockResolvedValue(undefined),
}));

const { Route } = await import("@/routes/api/generate-ai");
const handler = (
  Route.options.server as { handlers: { POST: (ctx: { request: Request }) => Promise<Response> } }
).handlers.POST;

type RpcResult = { data: unknown; error: unknown };

function createMockSupabase(opts: {
  userId?: string;
  profile?: { plan: string; role: string };
  reserve?: RpcResult;
  resolve?: RpcResult | RpcResult[]; // array = one result per successive call, for consumed-then-refund style sequencing
  genInsertFails?: boolean;
}) {
  const userId = opts.userId ?? "user-1";
  const profile = opts.profile ?? { plan: "free", role: "user" };
  const calls: { type: "rpc" | "from"; name: string; args?: unknown }[] = [];
  let resolveCallCount = 0;

  const rpc = vi.fn((name: string, args?: unknown) => {
    calls.push({ type: "rpc", name, args });
    if (name === "reserve_credits_v2") {
      return Promise.resolve(
        opts.reserve ?? {
          data: [{ ok: true, credits_used: 1, credits_limit: 60, reservation_id: "resv-1" }],
          error: null,
        },
      );
    }
    if (name === "resolve_credit_reservation") {
      const seq = Array.isArray(opts.resolve) ? opts.resolve : opts.resolve ? [opts.resolve] : [];
      const result = seq[resolveCallCount] ?? seq[seq.length - 1] ?? {
        data: [{ resolved: true, final_status: "consumed", refunded_cost: 0 }],
        error: null,
      };
      resolveCallCount++;
      return Promise.resolve(result);
    }
    return Promise.resolve({ data: null, error: null });
  });

  function makeQuery(table: string, selectArg?: string) {
    calls.push({ type: "from", name: table, args: selectArg });
    const query = {
      select: (cols?: string) => makeQuery(table, cols),
      insert: (row: unknown) => {
        calls.push({ type: "from", name: `${table}.insert`, args: row });
        return {
          select: () => ({
            maybeSingle: () =>
              Promise.resolve(
                opts.genInsertFails ? { data: null, error: null } : { data: { id: "gen-1" }, error: null },
              ),
          }),
        };
      },
      eq: () => query,
      maybeSingle: () => {
        if (table === "users" && selectArg === "plan,role") {
          return Promise.resolve({ data: profile, error: null });
        }
        if (table === "users") {
          return Promise.resolve({ data: { credits_used: 1, credits_limit: 60 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  }

  return {
    auth: {
      getUser: (_token: string) => Promise.resolve({ data: { user: { id: userId } }, error: null }),
    },
    from: (table: string) => makeQuery(table),
    rpc,
    calls,
  };
}

function makeRequest(body: unknown, token = "test-token"): Request {
  return new Request("https://test.local/api/generate-ai", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function drainStream(res: Response): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  const reader = res.body?.getReader();
  if (!reader) return events;
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }
  for (const line of buf.split("\n\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(trimmed.slice(5).trim()));
    } catch {
      /* ignore */
    }
  }
  return events;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  delete process.env.APP_ENV; // production-like: preview guard is a no-op
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("POST /api/generate-ai — auth and validation short-circuit before any credit reservation", () => {
  it("no bearer token: 401, no Supabase call at all", async () => {
    mockSupabase = createMockSupabase({});
    const res = await handler({
      request: new Request("https://test.local/api/generate-ai", { method: "POST" }),
    });
    expect(res.status).toBe(401);
  });

  it("empty prompt: 400, never reserves credits", async () => {
    mockSupabase = createMockSupabase({});
    const res = await handler({ request: makeRequest({ tool: "copywriter", prompt: "  " }) });
    expect(res.status).toBe(400);
    expect(mockSupabase.calls.some((c) => c.name === "reserve_credits_v2")).toBe(false);
  });

  it("unknown tool: 400, never reserves credits", async () => {
    mockSupabase = createMockSupabase({});
    const res = await handler({ request: makeRequest({ tool: "not-a-tool", prompt: "hola" }) });
    expect(res.status).toBe(400);
    expect(mockSupabase.calls.some((c) => c.name === "reserve_credits_v2")).toBe(false);
  });

  it("plan-gated tool without a qualifying plan: 403, never reserves credits", async () => {
    mockSupabase = createMockSupabase({ profile: { plan: "free", role: "user" } });
    const res = await handler({ request: makeRequest({ tool: "consultant", prompt: "hola" }) });
    expect(res.status).toBe(403);
    expect(mockSupabase.calls.some((c) => c.name === "reserve_credits_v2")).toBe(false);
  });
});

describe("POST /api/generate-ai — insufficient credits", () => {
  it("reserve_credits_v2.ok=false: 402, never calls the model", async () => {
    const callModelSpy = vi.spyOn(callModelModule, "callModel");
    mockSupabase = createMockSupabase({
      reserve: { data: [{ ok: false, credits_used: 60, credits_limit: 60, reservation_id: null }], error: null },
    });
    const res = await handler({ request: makeRequest({ tool: "copywriter", prompt: "hola" }) });
    expect(res.status).toBe(402);
    expect(callModelSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/generate-ai — successful generation", () => {
  it("reserves once, confirms consumed before sending done, never refunds", async () => {
    vi.spyOn(callModelModule, "callModel").mockImplementation(async (_tool, _prompt, onDelta) => {
      onDelta("contenido generado");
    });
    mockSupabase = createMockSupabase({
      resolve: { data: [{ resolved: true, final_status: "consumed", refunded_cost: 0 }], error: null },
    });
    const res = await handler({ request: makeRequest({ tool: "copywriter", prompt: "hola" }) });
    const events = await drainStream(res);

    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(mockSupabase.calls.filter((c) => c.name === "reserve_credits_v2")).toHaveLength(1);
    const resolveCalls = mockSupabase.calls.filter((c) => c.name === "resolve_credit_reservation");
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0].args).toMatchObject({ p_outcome: "consumed" });
  });

  it("confirmation fails after retries: sends error (not done), leaves the reservation unresolved, no refund", async () => {
    vi.spyOn(callModelModule, "callModel").mockImplementation(async (_tool, _prompt, onDelta) => {
      onDelta("contenido generado");
    });
    // Every resolve_credit_reservation attempt fails to confirm consumed —
    // this must never be silently treated as success.
    mockSupabase = createMockSupabase({
      resolve: { data: [{ resolved: false, final_status: "reserved", refunded_cost: 0 }], error: null },
    });
    const res = await handler({ request: makeRequest({ tool: "copywriter", prompt: "hola" }) });
    const events = await drainStream(res);

    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(true);
    const resolveCalls = mockSupabase.calls.filter(
      (c) =>
        c.name === "resolve_credit_reservation" &&
        (c.args as { p_outcome?: string })?.p_outcome === "refunded",
    );
    expect(resolveCalls).toHaveLength(0); // never blindly refund an ambiguous outcome
  });
});

describe("POST /api/generate-ai — provider failure after credits were reserved", () => {
  it("refunds exactly once, sends an error event, persists no generation", async () => {
    vi.spyOn(callModelModule, "callModel").mockRejectedValue(new Error("Model call failed"));
    mockSupabase = createMockSupabase({
      resolve: { data: [{ resolved: true, final_status: "refunded", refunded_cost: 1 }], error: null },
    });
    const res = await handler({ request: makeRequest({ tool: "copywriter", prompt: "hola" }) });
    const events = await drainStream(res);

    expect(events.some((e) => e.type === "error")).toBe(true);
    const resolveCalls = mockSupabase.calls.filter(
      (c) =>
        c.name === "resolve_credit_reservation" &&
        (c.args as { p_outcome?: string })?.p_outcome === "refunded",
    );
    expect(resolveCalls).toHaveLength(1);
    expect(mockSupabase.calls.some((c) => c.name === "generations.insert")).toBe(false);
  });

  it("client disconnect (stream cancel) also refunds exactly once, not twice with the catch path", async () => {
    let rejectModel!: (err: Error) => void;
    vi.spyOn(callModelModule, "callModel").mockImplementation(
      (_tool, _prompt, _onDelta, signal) =>
        new Promise((_resolve, reject) => {
          rejectModel = reject;
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    mockSupabase = createMockSupabase({
      resolve: { data: [{ resolved: true, final_status: "refunded", refunded_cost: 1 }], error: null },
    });
    const res = await handler({ request: makeRequest({ tool: "copywriter", prompt: "hola" }) });
    await res.body?.cancel();
    rejectModel(new DOMException("Aborted", "AbortError"));
    await new Promise((r) => setTimeout(r, 10));

    const resolveCalls = mockSupabase.calls.filter(
      (c) =>
        c.name === "resolve_credit_reservation" &&
        (c.args as { p_outcome?: string })?.p_outcome === "refunded",
    );
    expect(resolveCalls).toHaveLength(1);
  });
});
