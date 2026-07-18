import { describe, it, expect } from "vitest";
import { canRetryPlanning } from "@/lib/projects/planning-gate";

describe("canRetryPlanning", () => {
  it("allows retrying a project still in planning (no plan yet)", () => {
    expect(canRetryPlanning("planning", false)).toBe(true);
  });

  it("allows re-running the planner on awaiting_confirmation (regenerate the plan)", () => {
    expect(canRetryPlanning("awaiting_confirmation", true)).toBe(true);
  });

  it("allows retrying a project that failed during planning — no plan was ever saved", () => {
    expect(canRetryPlanning("failed", false)).toBe(true);
  });

  it("blocks retrying a project that failed during step execution — a real plan/progress exists", () => {
    expect(canRetryPlanning("failed", true)).toBe(false);
  });

  it.each(["ready", "running", "paused", "completed", "archived", "draft"])(
    "blocks retrying once the project has moved past planning (%s)",
    (status) => {
      expect(canRetryPlanning(status, true)).toBe(false);
      expect(canRetryPlanning(status, false)).toBe(false);
    },
  );
});
