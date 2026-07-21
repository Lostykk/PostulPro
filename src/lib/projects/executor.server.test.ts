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
            data: {
              plan: "free",
              credits_used: 1,
              credits_limit: 60,
              role: "user",
              ...usersRowOverride,
            },
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

// runProjectStep now derives appOrigin and a (possibly-null) waitUntil from
// a real Request — a plain Web Request has no `.waitUntil`, so getWaitUntil
// returns null and refundInBackground falls back to plain fire-and-forget,
// exactly like production outside Cloudflare Workers.
function fakeRequest(url = "https://test.local/api/projects/proj-1/run-next"): Request {
  return new Request(url, { method: "POST" });
}

function resolvedReservation(final_status: "consumed" | "refunded", refunded_cost = 0) {
  return { data: [{ resolved: true, final_status, refunded_cost }], error: null };
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
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    expect(res.status).toBe(409);
    expect(callModelSpy).not.toHaveBeenCalled();
    expect(supabase.calls.some((c) => c.name === "reserve_credits_v2")).toBe(false);
  });

  it("forbidden (wrong owner): 403, no credit/model side effects", async () => {
    const supabase = createMockSupabase({
      claim_ai_project_step: { data: [{ claimed: false, reason: "forbidden" }], error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    expect(res.status).toBe(403);
    expect(supabase.calls.some((c) => c.name === "reserve_credits_v2")).toBe(false);
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
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    expect(res.status).toBe(500);
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "invalid_tool" });
    expect(supabase.calls.some((c) => c.name === "reserve_credits_v2")).toBe(false);
  });
});

describe("runProjectStep — insufficient credits", () => {
  it("reserve_credits_v2.ok=false: fails the step, never calls the model", async () => {
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
      reserve_credits_v2: {
        data: [{ ok: false, credits_limit: 10, credits_used: 10, reservation_id: null }],
        error: null,
      },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    expect(res.status).toBe(402);
    expect(callModelSpy).not.toHaveBeenCalled();
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "insufficient_credits" });
  });
});

describe("runProjectStep — successful execution", () => {
  it("claims, reserves once, calls the model once, persists a generation, confirms consumed, completes the step — no refund", async () => {
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
      reserve_credits_v2: {
        data: [{ ok: true, credits_limit: 60, credits_used: 1, reservation_id: "resv-1" }],
        error: null,
      },
      mark_step_credits_reserved: { data: null, error: null },
      resolve_credit_reservation: resolvedReservation("consumed"),
      complete_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    const events = await drainStream(res);

    expect(events.some((e) => (e as { type: string }).type === "done")).toBe(true);
    expect(supabase.calls.filter((c) => c.name === "reserve_credits_v2")).toHaveLength(1);
    const resolveCalls = supabase.calls.filter((c) => c.name === "resolve_credit_reservation");
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0].args).toMatchObject({ p_outcome: "consumed" });
    expect(supabase.calls.filter((c) => c.name === "complete_ai_project_step")).toHaveLength(1);
    const insertCall = supabase.calls.find((c) => c.name === "generations.insert");
    expect(insertCall).toBeTruthy();
    // credit_reservation_id must be set in the SAME insert that persists
    // the result — this is the completion evidence the reconciler relies
    // on, not something wired up later or only in memory.
    expect(insertCall?.args).toMatchObject({ credit_reservation_id: "resv-1" });
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
      reserve_credits_v2: {
        data: [{ ok: true, credits_limit: 60, credits_used: 1, reservation_id: "resv-1" }],
        error: null,
      },
      mark_step_credits_reserved: { data: null, error: null },
      resolve_credit_reservation: resolvedReservation("refunded", 1),
      mark_reservation_job_outcome: { data: true, error: null },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    const events = await drainStream(res);

    expect(events.some((e) => (e as { type: string }).type === "error")).toBe(true);
    const resolveCalls = supabase.calls.filter(
      (c) =>
        c.name === "resolve_credit_reservation" &&
        (c.args as { p_outcome?: string })?.p_outcome === "refunded",
    );
    expect(resolveCalls).toHaveLength(1);
    expect(supabase.calls.some((c) => c.name === "generations.insert")).toBe(false);
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "failed" });
    // Confirmed-failure evidence must be recorded before the refund
    // attempt — so a reconciler run could recover this even if the
    // refund itself never landed.
    const markCall = supabase.calls.find((c) => c.name === "mark_reservation_job_outcome");
    expect(markCall?.args).toMatchObject({ p_reservation_id: "resv-1", p_outcome: "failed" });
  });

  it("terminal provider timeout: classified as timed_out, refunds exactly once", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(callModelModule, "callModel").mockImplementation(
      (_tool, _prompt, _onDelta, signal) =>
        new Promise((_resolve, reject) => {
          capturedSignal = signal;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "TimeoutError")),
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
      reserve_credits_v2: {
        data: [{ ok: true, credits_limit: 60, credits_used: 1, reservation_id: "resv-1" }],
        error: null,
      },
      mark_step_credits_reserved: { data: null, error: null },
      resolve_credit_reservation: resolvedReservation("refunded", 1),
      mark_reservation_job_outcome: { data: true, error: null },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    // Advance past the 240s provider circuit breaker without ever aborting
    // via the client — this must classify as timed_out, not aborted.
    await vi.advanceTimersByTimeAsync(240_001);
    const events = await drainStream(res);

    expect(capturedSignal?.aborted).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === "error")).toBe(true);
    const markCall = supabase.calls.find((c) => c.name === "mark_reservation_job_outcome");
    expect(markCall?.args).toMatchObject({ p_outcome: "timed_out" });
    const failCall = supabase.calls.find((c) => c.name === "fail_ai_project_step");
    expect(failCall?.args).toMatchObject({ p_error_code: "timed_out" });
    vi.useRealTimers();
  });

  it("generation persist failure after a real model success: treated as a confirmed failure, refunds, never marks consumed", async () => {
    vi.spyOn(callModelModule, "callModel").mockImplementation(async (_tool, _prompt, onDelta) => {
      onDelta("resultado generado");
    });
    const calls: { type: "rpc" | "from"; name: string; args?: unknown }[] = [];
    const rpc = vi.fn((name: string, args?: unknown) => {
      calls.push({ type: "rpc", name, args });
      const rpcResults: Record<string, { data: unknown; error: unknown }> = {
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
        reserve_credits_v2: {
          data: [{ ok: true, credits_limit: 60, credits_used: 1, reservation_id: "resv-1" }],
          error: null,
        },
        mark_step_credits_reserved: { data: null, error: null },
        mark_reservation_job_outcome: { data: true, error: null },
        resolve_credit_reservation: resolvedReservation("refunded", 1),
        fail_ai_project_step: { data: null, error: null },
      };
      return Promise.resolve(rpcResults[name] ?? { data: null, error: null });
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
          // Simulate a persist failure: the insert "succeeds" at the
          // HTTP level but returns no row (e.g. a constraint violation
          // PostgREST reports as an error alongside null data).
          if (table === "generations")
            return Promise.resolve({ data: null, error: { message: "db error" } });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    }
    const supabase = { rpc, from: (t: string) => makeQuery(t), calls } as unknown as Parameters<
      typeof runProjectStep
    >[0] & { calls: typeof calls };

    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    const events = await drainStream(res);

    expect(events.some((e) => (e as { type: string }).type === "error")).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === "done")).toBe(false);
    const resolveCalls = calls.filter(
      (c) =>
        c.name === "resolve_credit_reservation" &&
        (c.args as { p_outcome?: string })?.p_outcome === "consumed",
    );
    expect(resolveCalls).toHaveLength(0); // never marked consumed when the result wasn't actually saved
    const markCall = calls.find((c) => c.name === "mark_reservation_job_outcome");
    expect(markCall?.args).toMatchObject({ p_outcome: "failed" });
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
      reserve_credits_v2: {
        data: [{ ok: true, credits_limit: 60, credits_used: 1, reservation_id: "resv-1" }],
        error: null,
      },
      mark_step_credits_reserved: { data: null, error: null },
      resolve_credit_reservation: resolvedReservation("refunded", 1),
      mark_reservation_job_outcome: { data: true, error: null },
      fail_ai_project_step: { data: null, error: null },
    });
    const res = await runProjectStep(supabase, "user-1", "proj-1", "step-1", fakeRequest());
    // Simulate the client going away: cancel the stream, then let the
    // in-flight callModel promise reject via the same abort signal.
    await res.body?.cancel();
    rejectModel(new DOMException("Aborted", "AbortError"));
    await new Promise((r) => setTimeout(r, 10));

    const resolveCalls = supabase.calls.filter(
      (c) =>
        c.name === "resolve_credit_reservation" &&
        (c.args as { p_outcome?: string })?.p_outcome === "refunded",
    );
    expect(resolveCalls).toHaveLength(1);
    // cancel() itself never resolves anything (see the module comment) —
    // the actual refund and its evidence both come from runStep's catch
    // block, reached via the aborted callModel promise. classified as
    // "aborted" (client-driven), not a generic "failed".
    const markCall = supabase.calls.find((c) => c.name === "mark_reservation_job_outcome");
    expect(markCall?.args).toMatchObject({ p_outcome: "aborted" });
  });
});

describe("runProjectStep — preview allowlist gate short-circuits everything else", () => {
  it("rejects a non-allowlisted, non-admin user in preview before even claiming the step", async () => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = "the-qa-user";
    const supabase = createMockSupabase({}, { role: "user" });
    const res = await runProjectStep(supabase, "someone-else", "proj-1", "step-1", fakeRequest());
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
    const res = await runProjectStep(supabase, "founder-not-qa", "proj-1", "step-1", fakeRequest());
    // Proved past the gate: it reached the claim RPC (and got a normal 403
    // for an unrelated reason — "forbidden" ownership — not the preview
    // allowlist 403). A blocked-by-gate call never reaches claim at all.
    expect(supabase.calls.some((c) => c.name === "claim_ai_project_step")).toBe(true);
    expect(res.status).toBe(403);
    delete process.env.APP_ENV;
    delete process.env.AI_GENERATION_ENABLED;
    delete process.env.PREVIEW_AI_ALLOWED_USER_ID;
  });

  // Regression coverage for a real incident: a QA account already covered
  // by PREVIEW_AI_ALLOWED_EMAILS could plan a project (the route already
  // threaded email through) but got rejected running any of its steps,
  // because this call site never received the 6th `email` argument at all
  // — a plain oversight, not a logic bug in the guard itself. See
  // docs/build-with-ai-stuck-project-incident.md.
  it("allows a non-admin, non-user-id-allowlisted caller whose email is on PREVIEW_AI_ALLOWED_EMAILS", async () => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = "the-qa-user";
    process.env.PREVIEW_AI_ALLOWED_EMAILS = "qa2@example.com";
    const supabase = createMockSupabase(
      { claim_ai_project_step: { data: [{ claimed: false, reason: "forbidden" }], error: null } },
      { role: "user" },
    );
    const res = await runProjectStep(
      supabase,
      "someone-else",
      "proj-1",
      "step-1",
      fakeRequest(),
      "qa2@example.com",
    );
    // Same proof pattern as the admin case above: reached the claim RPC
    // (rejected for an unrelated reason), meaning the preview gate itself
    // let it through.
    expect(supabase.calls.some((c) => c.name === "claim_ai_project_step")).toBe(true);
    expect(res.status).toBe(403);
    delete process.env.APP_ENV;
    delete process.env.AI_GENERATION_ENABLED;
    delete process.env.PREVIEW_AI_ALLOWED_USER_ID;
    delete process.env.PREVIEW_AI_ALLOWED_EMAILS;
  });

  it("still rejects when the email argument is omitted (the exact shape of the real bug)", async () => {
    process.env.APP_ENV = "preview";
    process.env.AI_GENERATION_ENABLED = "true";
    process.env.PREVIEW_AI_ALLOWED_USER_ID = "the-qa-user";
    process.env.PREVIEW_AI_ALLOWED_EMAILS = "qa2@example.com";
    const supabase = createMockSupabase({}, { role: "user" });
    // No 6th argument passed — this is exactly what run-next.ts/run.ts/
    // retry.ts did before this fix, for an account allowlisted only by
    // email.
    const res = await runProjectStep(supabase, "someone-else", "proj-1", "step-1", fakeRequest());
    expect(res.status).toBe(403);
    expect(supabase.calls.filter((c) => c.type === "rpc")).toHaveLength(0);
    delete process.env.APP_ENV;
    delete process.env.AI_GENERATION_ENABLED;
    delete process.env.PREVIEW_AI_ALLOWED_USER_ID;
    delete process.env.PREVIEW_AI_ALLOWED_EMAILS;
  });
});
