import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Unit coverage for runStuckStepReconciliation() — mirrors
// reconcile-stuck-projects.server.test.ts exactly. See
// docs/build-with-ai-stuck-project-incident.md for the real incident this
// reconciler closes.
async function freshModule() {
  vi.resetModules();
  return import("@/lib/ai/reconcile-stuck-steps.server");
}

function mockSupabase(
  rpcDelayMs = 0,
  rpcResult: { data: unknown; error: unknown } = { data: [], error: null },
) {
  const calls: unknown[] = [];
  const client = {
    rpc: vi.fn((_name: string, args: unknown) => {
      calls.push(args);
      if (rpcDelayMs === 0) return Promise.resolve(rpcResult);
      return new Promise((resolve) => setTimeout(() => resolve(rpcResult), rpcDelayMs));
    }),
    calls,
  };
  return client as unknown as SupabaseClient<Database> & {
    rpc: typeof client.rpc;
    calls: unknown[];
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runStuckStepReconciliation — clamping", () => {
  it("clamps an out-of-range batch limit", async () => {
    const { runStuckStepReconciliation } = await freshModule();
    const supabase = mockSupabase();
    await runStuckStepReconciliation(supabase, 999999, "http");
    expect(supabase.rpc).toHaveBeenCalledWith("reconcile_stuck_ai_project_steps", {
      p_batch_limit: 500,
    });
  });

  it("uses the default when none is provided", async () => {
    const { runStuckStepReconciliation } = await freshModule();
    const supabase = mockSupabase();
    await runStuckStepReconciliation(supabase, undefined, "http");
    expect(supabase.rpc).toHaveBeenCalledWith("reconcile_stuck_ai_project_steps", {
      p_batch_limit: 200,
    });
  });
});

describe("runStuckStepReconciliation — concurrency guard", () => {
  it("rejects a second call while the first is still running", async () => {
    const { runStuckStepReconciliation, ReconcileRejected } = await freshModule();
    const supabase = mockSupabase(1000);
    const first = runStuckStepReconciliation(supabase, 10, "http");
    await Promise.resolve();
    const second = runStuckStepReconciliation(supabase, 10, "http");

    await expect(second).rejects.toThrow(ReconcileRejected);
    await expect(second).rejects.toMatchObject({ reason: "concurrent" });

    await vi.advanceTimersByTimeAsync(1000);
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("runStuckStepReconciliation — rate limit guard", () => {
  it("rejects a call made too soon after the previous one completed", async () => {
    const { runStuckStepReconciliation } = await freshModule();
    const supabase = mockSupabase(10);
    const p1 = runStuckStepReconciliation(supabase, 10, "http");
    await vi.advanceTimersByTimeAsync(10);
    await p1;

    await vi.advanceTimersByTimeAsync(1_000);
    const p2 = runStuckStepReconciliation(supabase, 10, "http");
    await expect(p2).rejects.toMatchObject({ reason: "rate_limited" });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("allows the very first call ever", async () => {
    const { runStuckStepReconciliation } = await freshModule();
    const supabase = mockSupabase(0);
    await expect(runStuckStepReconciliation(supabase, 10, "http")).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("runStuckStepReconciliation — outcome summary", () => {
  it("counts failed rows returned by the RPC", async () => {
    const { runStuckStepReconciliation } = await freshModule();
    const supabase = mockSupabase(0, {
      data: [
        { step_id: "a", project_id: "p1", outcome: "failed_timeout" },
        { step_id: "b", project_id: "p2", outcome: "failed_timeout" },
      ],
      error: null,
    });
    const result = await runStuckStepReconciliation(supabase, 10, "http");
    expect(result).toMatchObject({ ok: true, failedCount: 2 });
  });

  it("returns ok:false with an error message instead of throwing when the RPC errors", async () => {
    const { runStuckStepReconciliation } = await freshModule();
    const supabase = mockSupabase(0, { data: null, error: { message: "db unavailable" } });
    const result = await runStuckStepReconciliation(supabase, 10, "http");
    expect(result).toMatchObject({ ok: false, errorMessage: "db unavailable" });
  });
});
