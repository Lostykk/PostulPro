import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Unit coverage for runStuckProjectReconciliation() — mirrors
// reconcile-credits.server.test.ts exactly (same concurrency/rate-limit
// guard shape, same fresh-module-per-test isolation for the module-level
// singleton state). See docs/build-with-ai-stuck-project-incident.md for
// why this reconciler exists.
async function freshModule() {
  vi.resetModules();
  return import("@/lib/ai/reconcile-stuck-projects.server");
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

describe("runStuckProjectReconciliation — clamping", () => {
  it("clamps an out-of-range timeout and batch limit", async () => {
    const { runStuckProjectReconciliation } = await freshModule();
    const supabase = mockSupabase();
    await runStuckProjectReconciliation(supabase, 999999, 999999, "http");
    expect(supabase.rpc).toHaveBeenCalledWith("reconcile_stuck_ai_project_planning", {
      p_timeout_minutes: 24 * 60,
      p_batch_limit: 500,
    });
  });

  it("uses the defaults when neither is provided", async () => {
    const { runStuckProjectReconciliation } = await freshModule();
    const supabase = mockSupabase();
    await runStuckProjectReconciliation(supabase, undefined, undefined, "http");
    expect(supabase.rpc).toHaveBeenCalledWith("reconcile_stuck_ai_project_planning", {
      p_timeout_minutes: 15,
      p_batch_limit: 200,
    });
  });
});

describe("runStuckProjectReconciliation — concurrency guard", () => {
  it("rejects a second call while the first is still running", async () => {
    const { runStuckProjectReconciliation, ReconcileRejected } = await freshModule();
    const supabase = mockSupabase(1000);
    const first = runStuckProjectReconciliation(supabase, 15, 10, "http");
    await Promise.resolve();
    const second = runStuckProjectReconciliation(supabase, 15, 10, "http");

    await expect(second).rejects.toThrow(ReconcileRejected);
    await expect(second).rejects.toMatchObject({ reason: "concurrent" });

    await vi.advanceTimersByTimeAsync(1000);
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("runStuckProjectReconciliation — rate limit guard", () => {
  it("rejects a call made too soon after the previous one completed", async () => {
    const { runStuckProjectReconciliation } = await freshModule();
    const supabase = mockSupabase(10);
    const p1 = runStuckProjectReconciliation(supabase, 15, 10, "http");
    await vi.advanceTimersByTimeAsync(10);
    await p1;

    await vi.advanceTimersByTimeAsync(1_000);
    const p2 = runStuckProjectReconciliation(supabase, 15, 10, "http");
    await expect(p2).rejects.toMatchObject({ reason: "rate_limited" });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("allows the very first call ever", async () => {
    const { runStuckProjectReconciliation } = await freshModule();
    const supabase = mockSupabase(0);
    await expect(runStuckProjectReconciliation(supabase, 15, 10, "http")).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("runStuckProjectReconciliation — outcome summary", () => {
  it("counts failed rows returned by the RPC", async () => {
    const { runStuckProjectReconciliation } = await freshModule();
    const supabase = mockSupabase(0, {
      data: [
        { project_id: "a", outcome: "failed_timeout" },
        { project_id: "b", outcome: "failed_timeout" },
      ],
      error: null,
    });
    const result = await runStuckProjectReconciliation(supabase, 15, 10, "http");
    expect(result).toMatchObject({ ok: true, failedCount: 2 });
  });

  it("returns ok:false with an error message instead of throwing when the RPC errors", async () => {
    const { runStuckProjectReconciliation } = await freshModule();
    const supabase = mockSupabase(0, { data: null, error: { message: "db unavailable" } });
    const result = await runStuckProjectReconciliation(supabase, 15, 10, "http");
    expect(result).toMatchObject({ ok: false, errorMessage: "db unavailable" });
  });
});
