import { describe, it, expect } from "vitest";
import {
  CreateProjectInputSchema,
  ProjectPlanSchema,
  ProjectBriefSchema,
  PlanDeliverableSchema,
  IDEA_MIN_LEN,
} from "@/lib/projects/schema";

describe("CreateProjectInputSchema", () => {
  it("rejects an idea shorter than the minimum", () => {
    const result = CreateProjectInputSchema.safeParse({ idea: "hola" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty idea", () => {
    const result = CreateProjectInputSchema.safeParse({ idea: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an idea over the max length", () => {
    const result = CreateProjectInputSchema.safeParse({ idea: "a".repeat(4001) });
    expect(result.success).toBe(false);
  });

  it("accepts a valid idea and defaults executionMode/language", () => {
    const result = CreateProjectInputSchema.safeParse({ idea: "Quiero lanzar un curso de fotografía online" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionMode).toBe("guided");
      expect(result.data.language).toBe("es");
    }
  });

  it("rejects an invalid executionMode", () => {
    const result = CreateProjectInputSchema.safeParse({
      idea: "a".repeat(IDEA_MIN_LEN + 1),
      executionMode: "yolo",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace-only ideas down below the minimum", () => {
    const result = CreateProjectInputSchema.safeParse({ idea: "   \n\t  " });
    expect(result.success).toBe(false);
  });
});

describe("ProjectPlanSchema", () => {
  const validDeliverable = {
    toolKey: "copywriter",
    title: "Post de lanzamiento",
    description: "Un post anunciando el producto",
  };

  it("rejects a plan with zero deliverables", () => {
    const result = ProjectPlanSchema.safeParse({ title: "Mi proyecto", deliverables: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a plan with more than the max deliverables", () => {
    const result = ProjectPlanSchema.safeParse({
      title: "Mi proyecto",
      deliverables: Array.from({ length: 7 }, () => validDeliverable),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a minimal valid plan and fills in defaults", () => {
    const result = ProjectPlanSchema.safeParse({ title: "Mi proyecto", deliverables: [validDeliverable] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knownFacts).toEqual([]);
      expect(result.data.totalEstimatedCredits).toBe(0);
    }
  });
});

describe("PlanDeliverableSchema", () => {
  it("requires a title and description", () => {
    const result = PlanDeliverableSchema.safeParse({ toolKey: "copywriter" });
    expect(result.success).toBe(false);
  });

  it("caps estimatedCredits at a sane maximum (model output is untrusted)", () => {
    const result = PlanDeliverableSchema.safeParse({
      toolKey: "copywriter",
      title: "x",
      description: "y",
      estimatedCredits: 9999,
    });
    expect(result.success).toBe(false);
  });
});

describe("ProjectBriefSchema", () => {
  it("fills every field with safe defaults from an empty object", () => {
    const result = ProjectBriefSchema.parse({});
    expect(result.name).toBe("");
    expect(result.knownFacts).toEqual([]);
    expect(result.language).toBe("es");
  });

  it("accepts a real-world tone phrase up to 200 chars (a real planner run showed ~180 chars is normal, not exceptional)", () => {
    const realisticTone =
      "Profesional pero cercano y accesible, transmitiendo confianza y expertise sin ser intimidante, con un toque de calidez humana en cada interacción";
    expect(realisticTone.length).toBeLessThanOrEqual(200);
    const result = ProjectBriefSchema.parse({ tone: realisticTone });
    expect(result.tone).toBe(realisticTone);
  });

  it("still rejects a tone field beyond the 200-char cap", () => {
    const result = ProjectBriefSchema.safeParse({ tone: "a".repeat(201) });
    expect(result.success).toBe(false);
  });
});
