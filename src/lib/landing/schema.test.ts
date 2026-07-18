import { describe, expect, it } from "vitest";
import {
  createSection,
  emptyLandingV2,
  isLandingV2,
  migrateLegacyLanding,
  parseLandingV2,
  serializeLandingV2,
} from "@/lib/landing/schema";
import { emptyLandingData, type LandingPageData } from "@/lib/deliverables/parse-landing";

describe("emptyLandingV2", () => {
  it("produces a valid empty v2 document with no sections", () => {
    const doc = emptyLandingV2("Mi landing");
    expect(doc.version).toBe(2);
    expect(doc.sections).toEqual([]);
    expect(doc.seo.slug).toBe("mi-landing");
    expect(doc.publish_config.status).toBe("draft");
  });
});

describe("createSection", () => {
  it("gives every section type non-empty default content", () => {
    for (const type of [
      "announcement_bar",
      "navigation",
      "hero",
      "trust_logos",
      "problem",
      "solution",
      "benefits",
      "features",
      "how_it_works",
      "statistics",
      "testimonials",
      "comparison",
      "pricing",
      "offer",
      "guarantee",
      "faq",
      "lead_form",
      "final_cta",
      "footer",
    ] as const) {
      const s = createSection(type, 0);
      expect(s.type).toBe(type);
      expect(s.visible).toBe(true);
      expect(Object.keys(s.content).length).toBeGreaterThan(0);
    }
  });

  it("assigns unique ids across calls", () => {
    const a = createSection("hero", 0);
    const b = createSection("hero", 1);
    expect(a.id).not.toBe(b.id);
  });
});

describe("migrateLegacyLanding", () => {
  it("maps headline/subheadline/hero/cta into a hero section without dropping content", () => {
    const legacy: LandingPageData = {
      ...emptyLandingData(),
      headlines: ["Headline real", "Alterno"],
      subheadline: "Subheadline real",
      hero: "Texto de hero real",
      cta: "Empezar ya",
      heroImageUrl: "https://real.example/img.jpg",
    };
    const doc = migrateLegacyLanding(legacy, "Mi proyecto");
    const hero = doc.sections.find((s) => s.type === "hero");
    expect(hero?.content.title).toBe("Headline real");
    expect(hero?.content.subtitle).toBe("Subheadline real");
    expect(hero?.content.body).toBe("Texto de hero real");
    expect(hero?.content.ctaLabel).toBe("Empezar ya");
    expect(hero?.content.image?.url).toBe("https://real.example/img.jpg");
  });

  it("maps features into a benefits section", () => {
    const legacy: LandingPageData = {
      ...emptyLandingData(),
      headlines: ["H"],
      features: ["Rápido: ahorra tiempo", "Simple"],
    };
    const doc = migrateLegacyLanding(legacy);
    const benefits = doc.sections.find((s) => s.type === "benefits");
    expect(benefits?.content.items).toEqual([
      { title: "Rápido", body: "ahorra tiempo" },
      { title: "Simple", body: "" },
    ]);
  });

  it("maps faq entries verbatim", () => {
    const legacy: LandingPageData = {
      ...emptyLandingData(),
      headlines: ["H"],
      faq: [{ q: "¿Precio?", a: "Gratis" }],
    };
    const doc = migrateLegacyLanding(legacy);
    const faq = doc.sections.find((s) => s.type === "faq");
    expect(faq?.content.faq).toEqual([{ q: "¿Precio?", a: "Gratis" }]);
  });

  it("skips sections for empty legacy fields instead of rendering empty blocks", () => {
    const legacy: LandingPageData = { ...emptyLandingData(), headlines: ["H"] };
    const doc = migrateLegacyLanding(legacy);
    expect(doc.sections.some((s) => s.type === "testimonials")).toBe(false);
    expect(doc.sections.some((s) => s.type === "faq")).toBe(false);
    expect(doc.sections.some((s) => s.type === "benefits")).toBe(false);
  });

  it("always includes a hero and a final_cta section", () => {
    const doc = migrateLegacyLanding(emptyLandingData());
    expect(doc.sections[0].type).toBe("hero");
    expect(doc.sections[doc.sections.length - 1].type).toBe("final_cta");
  });
});

describe("parseLandingV2 / serializeLandingV2 / isLandingV2", () => {
  it("round-trips a document", () => {
    const doc = emptyLandingV2("Round trip");
    const serialized = serializeLandingV2(doc);
    const parsed = parseLandingV2(serialized);
    expect(parsed?.metadata.name).toBe("Round trip");
    expect(parsed?.seo.slug).toBe("round-trip");
  });

  it("returns null for legacy v1 JSON (no version:2 marker)", () => {
    expect(parseLandingV2(JSON.stringify(emptyLandingData()))).toBeNull();
  });

  it("returns null for non-JSON text", () => {
    expect(parseLandingV2("# Not json at all")).toBeNull();
  });

  it("isLandingV2 rejects arrays and non-2 versions", () => {
    expect(isLandingV2([])).toBe(false);
    expect(isLandingV2({ version: 1, sections: [] })).toBe(false);
    expect(isLandingV2({ version: 2, sections: [] })).toBe(true);
  });
});
