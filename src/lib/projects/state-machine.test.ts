import { describe, it, expect } from "vitest";
import {
  canClaimStep,
  canSkipStep,
  isTerminalStepStatus,
  isTerminalProjectStatus,
  canConfirmPlan,
  canPause,
  canResume,
  canRunNext,
  computeProgress,
  deriveStepIdempotencyKey,
  briefChanged,
} from "@/lib/projects/state-machine";

describe("canClaimStep", () => {
  it("allows claiming pending, ready and failed steps", () => {
    expect(canClaimStep("pending")).toBe(true);
    expect(canClaimStep("ready")).toBe(true);
    expect(canClaimStep("failed")).toBe(true);
  });
  it("refuses to claim a step that is already running or completed", () => {
    expect(canClaimStep("running")).toBe(false);
    expect(canClaimStep("completed")).toBe(false);
    expect(canClaimStep("skipped")).toBe(false);
    expect(canClaimStep("cancelled")).toBe(false);
  });
});

describe("canSkipStep / terminal statuses", () => {
  it("mirrors canClaimStep's claimable set", () => {
    expect(canSkipStep("failed")).toBe(true);
    expect(canSkipStep("completed")).toBe(false);
  });
  it("flags completed/skipped/cancelled as terminal", () => {
    expect(isTerminalStepStatus("completed")).toBe(true);
    expect(isTerminalStepStatus("skipped")).toBe(true);
    expect(isTerminalStepStatus("running")).toBe(false);
  });
  it("flags completed/archived projects as terminal", () => {
    expect(isTerminalProjectStatus("completed")).toBe(true);
    expect(isTerminalProjectStatus("archived")).toBe(true);
    expect(isTerminalProjectStatus("running")).toBe(false);
  });
});

describe("canConfirmPlan", () => {
  it("only allows confirming a fresh plan awaiting confirmation", () => {
    expect(canConfirmPlan("awaiting_confirmation", false)).toBe(true);
  });
  it("refuses to confirm a stale plan even if status matches", () => {
    expect(canConfirmPlan("awaiting_confirmation", true)).toBe(false);
  });
  it("refuses to confirm from any other status", () => {
    expect(canConfirmPlan("ready", false)).toBe(false);
    expect(canConfirmPlan("draft", false)).toBe(false);
  });
});

describe("pause/resume/run-next gating", () => {
  it("can only pause a running project", () => {
    expect(canPause("running")).toBe(true);
    expect(canPause("paused")).toBe(false);
  });
  it("can only resume a paused project", () => {
    expect(canResume("paused")).toBe(true);
    expect(canResume("running")).toBe(false);
  });
  it("run-next is allowed for ready/running/paused, not for draft or completed", () => {
    expect(canRunNext("ready")).toBe(true);
    expect(canRunNext("running")).toBe(true);
    expect(canRunNext("paused")).toBe(true);
    expect(canRunNext("draft")).toBe(false);
    expect(canRunNext("completed")).toBe(false);
  });
});

describe("computeProgress", () => {
  it("returns 0 for a project with no steps", () => {
    expect(computeProgress(0, 0)).toBe(0);
  });
  it("rounds to the nearest whole percent", () => {
    expect(computeProgress(1, 3)).toBe(33);
    expect(computeProgress(2, 3)).toBe(67);
  });
  it("never exceeds 100 even if done > total", () => {
    expect(computeProgress(5, 3)).toBe(100);
  });
});

describe("deriveStepIdempotencyKey", () => {
  it("is deterministic for the same inputs", () => {
    const a = deriveStepIdempotencyKey("proj-1", 2, "copywriter");
    const b = deriveStepIdempotencyKey("proj-1", 2, "copywriter");
    expect(a).toBe(b);
  });
  it("differs when position or tool changes", () => {
    const base = deriveStepIdempotencyKey("proj-1", 1, "copywriter");
    expect(deriveStepIdempotencyKey("proj-1", 2, "copywriter")).not.toBe(base);
    expect(deriveStepIdempotencyKey("proj-1", 1, "social-pack")).not.toBe(base);
  });
});

describe("briefChanged", () => {
  it("detects no change for structurally equal objects", () => {
    expect(briefChanged({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(false);
  });
  it("detects a change in a nested field", () => {
    expect(briefChanged({ a: 1 }, { a: 2 })).toBe(true);
  });
});
