import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runProjectStep } from "@/lib/projects/executor.server";
import * as callModelModule from "@/lib/ai/call-model.server";

// A minimal, chainable mock of the Supabase client surface runProjectStep
// actually uses: .rpc(name, args) and .from(table).select/insert/eq/maybeSingle.
// Each test configures rpcResults[name] to control what that RPC "returns",
// and asserts on the recorded call log instead of a real database.
function createMockSupabase(
  rpcResults: Record<string, { data: unknown; error: unknown }>,
  usersRowOverride?: Record<string, unknown>,
) {
  const calls: { type: "rpc" | "from"; name: string; args?: unknown }[] = [];

  const rpc = vi.fn((name: string, args?: unknown) => {
    calls.push({ type: "rpc", name, args });
    const result = rpcResults[name] ?? { data: null, error: null };
    return Promise.resolve(result);
  });

  function makeQuery(table: string) {
    calls.push({ type: "from", name: table });
    const query = {
      select: () => query,
      insert: (row: unknown) => {
        calls.push({ type: "from", name: `${table}.insert`, args: row });
        return query;
      },
      eq: () => query,
      maybeSingle: () => {
        if (table === "generations") return Promise.resolve({ data: { id: "gen-1" }, error: null });
        if (table === "users")
          return Promise.resolve({
            data: { plan: "free", credits_used: 1, credits_limit: 60, role: "user", ...usersRowOverride },
            error: null,
          });
        if (table === "ai_projects")
          return Promise.resolve({
            data: {
              status: "running",
              progress_percent: 50,
              spent_credits: 1,
              current_step_id: null,
            },
            error: null,
          });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  }

  return {
    rpc,
    from: (table: string) => makeQuery(table),
    calls,
  } as unknown as Parameters<typeof runProjectStep>[0] & { calls: typeof calls; rpc: typeof rpc };
}

async function drainStream(res: Response): Promise<unknown[]> {
  const events: unknown[] = [];
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

beforeEach(() => {
  delete process.env.APP_ENV; // production-like: preview guard is a no-op
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runProjectStep — claim failures never reach credits or the provider", () => {
  it("not_claimable: no reserve, no model call, no fail_ai_project_step", async () => {
    const callModelSpy = vi.spyOn(callModelModule, "callModel");
    const supabase = createMockSupabase({
      claim_ai_project_step: { data: [{ claimed: false, reason: "not_claimable" }], error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    expect(res.status).toBe(409);
    expect(callModelSpy).not.toHaveBeenCalled();
    expect(supabase.calls.some((c) => c.name === "reserve_credits")).toBe(false);
  });

  it("forbidden (wrong owner): 403, no credit/model side effects", async () => {
    const supabase = createMockSupabase({
      claim_ai_project_step: { data: [{ claimed: false, reason: "forbidden" }], error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    expect(res.status).toBe(403);
    expect(supabase.calls.some((c) => c.name === "reserve_credits")).toBe(false);
  });
});

describe("runProjectStep — invalid tool and plan gate fail before any credit reservation", () => {
  it("unknown tool_key: fails the step, never reserves credits", async () => {
    const supabase = createMockSupabase({
      claim_ai_project_step: {
        data: [
          {
            claimed: true,
            reason: "ok",
            tool_key: "not-a-real-tool",
            credits_cost: 1,
            brief_json: {},
            input_json: {},
            attempts: 1,
          },
        ],
        error: null,
      },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    expect(res.status).toBe(500);
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "invalid_tool" });
    expect(supabase.calls.some((c) => c.name === "reserve_credits")).toBe(false);
  });
});

describe("runProjectStep — insufficient credits", () => {
  it("reserve_credits.ok=false: fails the step, never calls the model", async () => {
    const callModelSpy = vi.spyOn(callModelModule, "callModel");
    const supabase = createMockSupabase({
      claim_ai_project_step: {
        data: [
          {
            claimed: true,
            reason: "ok",
            tool_key: "copywriter",
            credits_cost: 1,
            brief_json: {},
            input_json: {},
            attempts: 1,
          },
        ],
        error: null,
      },
      reserve_credits: { data: [{ ok: false, credits_limit: 10, credits_used: 10 }], error: null },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    expect(res.status).toBe(402);
    expect(callModelSpy).not.toHaveBeenCalled();
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "insufficient_credits" });
  });
});

describe("runProjectStep — successful execution", () => {
  it("claims, reserves once, calls the model once, persists a generation, completes the step — no refund", async () => {
    vi.spyOn(callModelModule, "callModel").mockImplementation(async (_tool, _prompt, onDelta) => {
      onDelta("resultado generado");
    });
    const supabase = createMockSupabase({
      claim_ai_project_step: {
        data: [
          {
            claimed: true,
            reason: "ok",
            tool_key: "copywriter",
            credits_cost: 1,
            brief_json: {},
            input_json: {},
            attempts: 1,
          },
        ],
        error: null,
      },
      reserve_credits: { data: [{ ok: true, credits_limit: 60, credits_used: 1 }], error: null },
      mark_step_credits_reserved: { data: null, error: null },
      complete_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    const events = await drainStream(res);

    expect(events.some((e) => (e as { type: string }).type === "done")).toBe(true);
    expect(supabase.calls.filter((c) => c.name === "reserve_credits")).toHaveLength(1);
    expect(supabase.calls.filter((c) => c.name === "refund_credits")).toHaveLength(0);
    expect(supabase.calls.filter((c) => c.name === "complete_ai_project_step")).toHaveLength(1);
    expect(supabase.calls.some((c) => c.name === "generations.insert")).toBe(true);
  });
});

describe("runProjectStep — provider failure after credits were reserved", () => {
  it("refunds exactly once, fails the step, persists no generation", async () => {
    vi.spyOn(callModelModule, "callModel").mockRejectedValue(
      new Error("ANTHROPIC_API_KEY not configured"),
    );
    const supabase = createMockSupabase({
      claim_ai_project_step: {
        data: [
          {
            claimed: true,
            reason: "ok",
            tool_key: "copywriter",
            credits_cost: 1,
            brief_json: {},
            input_json: {},
            attempts: 1,
          },
        ],
        error: null,
      },
      reserve_credits: { data: [{ ok: true, credits_limit: 60, credits_used: 1 }], error: null },
      mark_step_credits_reserved: { data: null, error: null },
      refund_credits: { data: null, error: null },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    const events = await drainStream(res);

    expect(events.some((e) => (e as { type: string }).type === "error")).toBe(true);
    expect(supabase.calls.filter((c) => c.name === "refund_credits")).toHaveLength(1);
    expect(supabase.calls.some((c) => c.name === "generations.insert")).toBe(false);
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "provider_error" });
  });

  it("client disconnect (stream cancel) also refunds exactly once, not twice with the catch path", async () => {
    let rejectModel!: (err: Error) => void;
    vi.spyOn(callModelModule, "callModel").mockImplementation(
      (_tool, _prompt, _onDelta, signal) =>
        new Promise((_resolve, reject) => {
          rejectModel = reject;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const supabase = createMockSupabase({
      claim_ai_project_step: {
        data: [
          {
            claimed: true,
            reason: "ok",
            tool_key: "copywriter",
            credits_cost: 1,
            brief_json: {},
            input_json: {},
            attempts: 1,
          },
        ],
        error: null,
      },
      reserve_credits: { data: [{ ok: true, credits_limit: 60, credits_used: 1 }], error: null },
      mark_step_credits_reserved: { data: null, error: null },
      refund_credits: { data: null, error: null },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1");
    // Simulate the client going away: cancel the stream, then let the
    // in-flight callModel promise reject via the same abort signal.
    await res.body?.cancel();
    rejectModel(new DOMException("Aborted", "AbortError"));
    await new Promise((r) => setTimeout(r, 10));

    expect(supabase.calls.filter((c) => c.name === "refund_credits")).toHaveLength(1);
  });
});

describe("runProjectStep — preview allowlist gate short-circuits everything else", () => {
  it("rejects a non-allowlisted, non-admin user in preview before even claiming the step", async () => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = "the-qa-user";
    const supabase = createMockSupabase({}, { role: "user" });
    const res = await runProjectStep(supabase, "someone-else", "proj-1", "step-1");
    expect(res.status).toBe(403);
    // The only DB interaction allowed before rejection is the role lookup
    // itself (needed to know the caller isn't an admin) — the claim/reserve
    // RPCs that actually do something must never be reached.
    expect(supabase.calls.filter((c) => c.type === "rpc")).toHaveLength(0);
    delete process.env.APP_ENV;
    delete process.env.AI_GENERATION_ENABLED;
    delete process.env.PREVIEW_AI_ALLOWED_USER_ID;
  });

  it("allows an admin who is NOT the allowlisted QA user to proceed past the gate", async () => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = "the-qa-user";
    const supabase = createMockSupabase(
      {
        claim_ai_project_step: { data: [{ claimed: false, reason: "forbidden" }], error: null },
      },
      { role: "admin" },
    );
    const res = await runProjectStep(supabase, "founder-not-qa", "proj-1", "step-1");
    // Proved past the gate: it reached the claim RPC (and got a normal 403
    // for an unrelated reason — "forbidden" ownership — not the preview
    // allowlist 403). A blocked-by-gate call never reaches claim at all.
    expect(supabase.calls.some((c) => c.name === "claim_ai_project_step")).toBe(true);
    expect(res.status).toBe(403);
    delete process.env.APP_ENV;
    delete process.env.AI_GENERATION_ENABLED;
    delete process.env.PREVIEW_AI_ALLOWED_USER_ID;
  });
});
