import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Unit coverage for the concurrency/rate-limit guards in
// runReconciliation() — these protect the internal reconcile endpoint
// (and, once wired up, a scheduled trigger) against abusive simultaneous
// or rapid-fire calls. Deterministic by construction (fake timers, a
// controllable mock RPC), which is a stronger guarantee for racing logic
// than timing two real HTTP calls against Cloudflare's edge would be.
//
// runReconciliation's concurrency/rate-limit guard is module-level state
// (a real, warm-isolate-scoped singleton in production — see the
// module's own comment on why that's an honest, if imperfect,
// protection). Each test gets a fresh module instance via
// vi.resetModules() + a fresh dynamic import, so tests don't bleed their
// "last completed at" timestamps into each other.
async function freshModule() {
  vi.resetModules();
  return import("@/lib/ai/reconcile-credits.server");
}

function mockSupabase(
  rpcDelayMs = 0,
  rpcResult: { data: unknown; error: unknown } = { data: [], error: null },
) {
  const calls: unknown[] = [];
  const client = {
    rpc: vi.fn((_name: string, args: unknown) => {
      calls.push(args);
      // With fake timers active, even a 0ms setTimeout needs an explicit
      // timer advance to resolve — skip it entirely for the zero-delay
      // case so tests that don't care about overlap timing don't need to
      // remember to tick the clock.
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

describe("runReconciliation — batch limit clamping", () => {
  it("clamps an out-of-range batch limit and defaults an invalid one", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase();
    await runReconciliation(supabase, 99999, "http");
    expect(supabase.rpc).toHaveBeenCalledWith("reconcile_stale_reservations_v2", {
      p_batch_limit: 500,
    });
  });

  it("uses the default batch limit when none is provided", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase();
    await runReconciliation(supabase, undefined, "http");
    expect(supabase.rpc).toHaveBeenCalledWith("reconcile_stale_reservations_v2", {
      p_batch_limit: 200,
    });
  });
});

describe("runReconciliation — concurrency guard", () => {
  it("rejects a second call while the first is still running, in the same isolate", async () => {
    const { runReconciliation, ReconcileRejected } = await freshModule();
    const supabase = mockSupabase(1000); // slow enough to overlap with a second call
    const first = runReconciliation(supabase, 10, "http");
    // Give the first call's guard a chance to register before firing the second.
    await Promise.resolve();
    const second = runReconciliation(supabase, 10, "http");

    await expect(second).rejects.toThrow(ReconcileRejected);
    await expect(second).rejects.toMatchObject({ reason: "concurrent" });

    await vi.advanceTimersByTimeAsync(1000);
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    // Only the first call's RPC actually ran — the concurrent one was
    // rejected before ever reaching the RPC layer.
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("allows a new call once the previous one has completed and the minimum interval has passed", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase(10);
    const p1 = runReconciliation(supabase, 10, "http");
    await vi.advanceTimersByTimeAsync(10);
    const first = await p1;
    expect(first.ok).toBe(true);

    // Past the 5s minimum interval — the next call must be allowed.
    await vi.advanceTimersByTimeAsync(5_001);
    const p2 = runReconciliation(supabase, 10, "http");
    await vi.advanceTimersByTimeAsync(10);
    await expect(p2).resolves.toMatchObject({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});

describe("runReconciliation — rate limit guard", () => {
  it("rejects a call made too soon after the previous one completed", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase(10);
    const p1 = runReconciliation(supabase, 10, "http");
    await vi.advanceTimersByTimeAsync(10);
    await p1;

    // Well within the 5s minimum interval since the last completion.
    await vi.advanceTimersByTimeAsync(1_000);
    const p2 = runReconciliation(supabase, 10, "http");
    await expect(p2).rejects.toMatchObject({ reason: "rate_limited" });
    expect(supabase.rpc).toHaveBeenCalledTimes(1); // the rejected call never reached the RPC
  });

  it("allows the very first call ever (no prior completion to rate-limit against)", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase(0);
    await expect(runReconciliation(supabase, 10, "http")).resolves.toMatchObject({ ok: true });
  });
});

describe("runReconciliation — outcome summary", () => {
  it("summarizes consumed/refunded counts correctly", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase(0, {
      data: [
        { reservation_id: "a", outcome: "consumed", evidence: "linked_generation" },
        { reservation_id: "b", outcome: "refunded", evidence: "failed" },
        { reservation_id: "c", outcome: "refunded", evidence: "no_evidence_after_threshold" },
      ],
      error: null,
    });
    const result = await runReconciliation(supabase, 10, "http");
    expect(result).toMatchObject({ ok: true, inspected: 3, consumed: 1, refunded: 2 });
  });

  it("returns ok:false with an error message instead of throwing when the RPC errors", async () => {
    const { runReconciliation } = await freshModule();
    const supabase = mockSupabase(0, { data: null, error: { message: "db unavailable" } });
    const result = await runReconciliation(supabase, 10, "http");
    expect(result).toMatchObject({ ok: false, errorMessage: "db unavailable" });
  });
});
