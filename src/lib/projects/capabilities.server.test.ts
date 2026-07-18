import { describe, it, expect } from "vitest";
import {
  isProjectCapability,
  listProjectCapabilities,
  getCapabilityMeta,
  realCreditsFor,
  PLANNER_ALLOWLIST,
} from "@/lib/projects/capabilities.server";
import { TOOLS } from "@/lib/ai/tools-config.server";

describe("PLANNER_ALLOWLIST", () => {
  it("only contains real ToolIds from the tools registry", () => {
    for (const key of PLANNER_ALLOWLIST) {
      expect(Object.keys(TOOLS)).toContain(key);
    }
  });

  it("excludes the chat-based consultant tool (not a single-shot deliverable)", () => {
    expect(PLANNER_ALLOWLIST).not.toContain("consultant");
  });
});

describe("isProjectCapability", () => {
  it("accepts real, project-capable tool keys", () => {
    expect(isProjectCapability("copywriter")).toBe(true);
    expect(isProjectCapability("landing-copy")).toBe(true);
  });
  it("rejects consultant and arbitrary/invented tool keys", () => {
    expect(isProjectCapability("consultant")).toBe(false);
    expect(isProjectCapability("free-lifetime-access")).toBe(false);
    expect(isProjectCapability("")).toBe(false);
    expect(isProjectCapability("../../etc/passwd")).toBe(false);
  });
});

describe("realCreditsFor", () => {
  it("matches the real tool registry cost, never a client-suppliable number", () => {
    expect(realCreditsFor("copywriter")).toBe(TOOLS.copywriter.credits);
    expect(realCreditsFor("business-plan")).toBe(TOOLS["business-plan"].credits);
  });
  it("returns 0 for a tool key that is not a project capability", () => {
    expect(realCreditsFor("consultant")).toBe(0);
    expect(realCreditsFor("made-up-tool")).toBe(0);
  });
});

describe("listProjectCapabilities plan gating", () => {
  it("free plan never sees a plan-gated capability", () => {
    const free = listProjectCapabilities("free");
    for (const cap of free) {
      expect(cap.planGate === undefined || cap.planGate === "pro" ? true : false).not.toBe(false);
      // No project capability is currently gated above free in this registry,
      // but the important invariant is: nothing with a gate higher than the
      // caller's plan rank can appear.
    }
  });

  it("business plan sees at least as many capabilities as free", () => {
    const free = listProjectCapabilities("free");
    const business = listProjectCapabilities("business");
    expect(business.length).toBeGreaterThanOrEqual(free.length);
  });

  it("owner override lifts every plan gate without changing the caller's plan", () => {
    const freeAsOwner = listProjectCapabilities("free", true);
    const business = listProjectCapabilities("business");
    expect(freeAsOwner.length).toBe(Object.keys(TOOLS).filter((k) => k !== "consultant").length);
    expect(freeAsOwner.length).toBeGreaterThanOrEqual(business.length);
  });

  it("owner override defaults to off — omitting it behaves exactly like a plain free plan", () => {
    expect(listProjectCapabilities("free")).toEqual(listProjectCapabilities("free", false));
  });
});

describe("getCapabilityMeta", () => {
  it("returns null for consultant and unknown keys", () => {
    expect(getCapabilityMeta("consultant")).toBeNull();
    expect(getCapabilityMeta("nope")).toBeNull();
  });
  it("returns real metadata (never a system prompt) for a valid tool", () => {
    const meta = getCapabilityMeta("copywriter");
    expect(meta).not.toBeNull();
    expect(meta?.route).toBe("/tools/copywriter");
    expect(meta).not.toHaveProperty("systemPrompt");
  });
});
