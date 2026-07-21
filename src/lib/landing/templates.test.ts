import { describe, expect, it } from "vitest";
import { LANDING_TEMPLATE_LIST, LANDING_TEMPLATES, templateConfig } from "@/lib/landing/templates";
import { LANDING_TEMPLATE_IDS } from "@/lib/landing/schema";

describe("LANDING_TEMPLATES", () => {
  it("defines exactly the 8 required templates", () => {
    expect(LANDING_TEMPLATE_LIST).toHaveLength(8);
    expect(new Set(LANDING_TEMPLATE_LIST.map((t) => t.id))).toEqual(new Set(LANDING_TEMPLATE_IDS));
  });

  it("every template has a non-empty name, description and recommendation", () => {
    for (const t of LANDING_TEMPLATE_LIST) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.shortDescription.length).toBeGreaterThan(0);
      expect(t.recommendedFor.length).toBeGreaterThan(0);
      expect(t.defaultSectionTypes.length).toBeGreaterThan(0);
    }
  });

  it("templates are not 8 near-identical reskins — hero layout, nav style, grid density, card style and footer combine into distinct fingerprints", () => {
    const fingerprints = LANDING_TEMPLATE_LIST.map(
      (t) => `${t.heroLayout}|${t.navStyle}|${t.gridColumns}|${t.cardStyle}|${t.footerStyle}|${t.headingTransform}`,
    );
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it("uses more than one hero layout, nav style and footer style across the 8 templates", () => {
    expect(new Set(LANDING_TEMPLATE_LIST.map((t) => t.heroLayout)).size).toBeGreaterThan(1);
    expect(new Set(LANDING_TEMPLATE_LIST.map((t) => t.navStyle)).size).toBeGreaterThan(1);
    expect(new Set(LANDING_TEMPLATE_LIST.map((t) => t.footerStyle)).size).toBeGreaterThan(1);
    expect(new Set(LANDING_TEMPLATE_LIST.map((t) => t.gridColumns)).size).toBeGreaterThan(1);
  });

  it("templateConfig falls back to saas_premium for an unknown id instead of throwing", () => {
    // @ts-expect-error intentionally invalid id to exercise the fallback
    expect(templateConfig("not_a_real_id").id).toBe("saas_premium");
  });

  it("each template's default preset actually exists", () => {
    const validPresetIds = new Set(["authority_dark", "conversion_light", "bold_brand", "moderno", "minimalista", "elegante", "tecnologico", "calido"]);
    for (const t of LANDING_TEMPLATE_LIST) {
      expect(validPresetIds.has(t.defaultPresetId)).toBe(true);
    }
  });

  it("every default section list includes a hero and a final_cta, so no template ships without a headline or a closing CTA", () => {
    for (const t of LANDING_TEMPLATE_LIST) {
      expect(t.defaultSectionTypes).toContain("hero");
      expect(t.defaultSectionTypes).toContain("final_cta");
    }
  });
});

describe("LANDING_TEMPLATES registry integrity", () => {
  it("has no duplicate keys vs id mismatches", () => {
    for (const [key, cfg] of Object.entries(LANDING_TEMPLATES)) {
      expect(cfg.id).toBe(key);
    }
  });
});
