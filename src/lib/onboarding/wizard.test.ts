import { describe, it, expect, vi } from "vitest";
import {
  canAdvance,
  runCompleteOnboarding,
  shouldRedirectToDashboard,
  stepLockDuration,
  stepTransitionDuration,
} from "./wizard";

describe("canAdvance", () => {
  it("step 1 requires a goal to be picked", () => {
    expect(canAdvance(1, { goal: null, target: 2000, name: "" })).toBe(false);
    expect(canAdvance(1, { goal: "passive_income", target: 2000, name: "" })).toBe(true);
  });

  it("step 2 requires a positive revenue target", () => {
    expect(canAdvance(2, { goal: "passive_income", target: 0, name: "" })).toBe(false);
    expect(canAdvance(2, { goal: "passive_income", target: 500, name: "" })).toBe(true);
  });

  it("step 3 requires a name of at least 2 characters", () => {
    expect(canAdvance(3, { goal: "passive_income", target: 500, name: "a" })).toBe(false);
    expect(canAdvance(3, { goal: "passive_income", target: 500, name: " a " })).toBe(false);
    expect(canAdvance(3, { goal: "passive_income", target: 500, name: "Ana" })).toBe(true);
  });
});

describe("stepTransitionDuration / stepLockDuration", () => {
  it("collapse to zero when the user prefers reduced motion", () => {
    expect(stepTransitionDuration(true)).toBe(0);
    expect(stepLockDuration(true)).toBe(0);
  });

  it("use the normal crossfade/lock timing otherwise", () => {
    expect(stepTransitionDuration(false)).toBeGreaterThan(0);
    expect(stepLockDuration(false)).toBeGreaterThan(0);
  });
});

describe("runCompleteOnboarding", () => {
  it("refreshes the profile exactly once after a successful RPC", async () => {
    const refreshProfile = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ error: null });

    const result = await runCompleteOnboarding({ rpc, refreshProfile });

    expect(result).toEqual({ ok: true });
    expect(refreshProfile).toHaveBeenCalledTimes(1);
  });

  it("surfaces the RPC error and never refreshes the profile", async () => {
    const refreshProfile = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ error: { message: "boom" } });

    const result = await runCompleteOnboarding({ rpc, refreshProfile });

    expect(result).toEqual({ ok: false, message: "boom" });
    expect(refreshProfile).not.toHaveBeenCalled();
  });

  it("awaits a slow RPC before touching the profile at all", async () => {
    const order: string[] = [];
    let resolveRpc!: (v: { error: null }) => void;
    const rpc = vi.fn(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveRpc = resolve;
        }),
    );
    const refreshProfile = vi.fn(async () => {
      order.push("refresh");
    });

    const pending = runCompleteOnboarding({ rpc, refreshProfile });
    // The RPC hasn't resolved yet, so refreshProfile must not have run.
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshProfile).not.toHaveBeenCalled();

    order.push("rpc-resolves");
    resolveRpc({ error: null });
    const result = await pending;

    expect(result).toEqual({ ok: true });
    expect(order).toEqual(["rpc-resolves", "refresh"]);
  });
});

describe("shouldRedirectToDashboard", () => {
  it("does not redirect when there is no profile yet", () => {
    expect(shouldRedirectToDashboard(null, false)).toBe(false);
  });

  it("does not redirect when onboarding isn't completed", () => {
    expect(shouldRedirectToDashboard({ onboarding_completed: false }, false)).toBe(false);
  });

  it("redirects when a stale/external profile already shows onboarding complete", () => {
    expect(shouldRedirectToDashboard({ onboarding_completed: true }, false)).toBe(true);
  });

  it("does NOT redirect right after this session's own completion, so the welcome modal can show first", () => {
    // Regression test for the exact bug: refresh() makes onboarding_completed
    // true in the shared profile cache the instant complete() succeeds; without
    // the justCompleted guard this would immediately redirect and skip the modal.
    expect(shouldRedirectToDashboard({ onboarding_completed: true }, true)).toBe(false);
  });
});
