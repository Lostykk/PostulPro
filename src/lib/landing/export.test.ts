import { describe, expect, it } from "vitest";
import { buildLandingHtml } from "@/lib/landing/export";
import { createSection, emptyLandingV3, type LandingTemplateId } from "@/lib/landing/schema";

function docWithSections(sections: ReturnType<typeof createSection>[], templateId?: LandingTemplateId) {
  const doc = emptyLandingV3("Test landing", templateId);
  doc.sections = sections;
  return doc;
}

describe("buildLandingHtml", () => {
  it("renders visible section content and omits hidden sections", () => {
    const hero = createSection("hero", 0);
    hero.content.title = "Headline visible";
    const hidden = createSection("faq", 1);
    hidden.visible = false;
    hidden.content.faq = [{ q: "¿Se ve esto?", a: "No debería" }];

    const html = buildLandingHtml(docWithSections([hero, hidden]));
    expect(html).toContain("Headline visible");
    expect(html).not.toContain("¿Se ve esto?");
  });

  it("renders an abstract SVG fallback visual instead of a pending placeholder when no hero image is set", () => {
    const hero = createSection("hero", 0);
    const html = buildLandingHtml(docWithSections([hero]));
    expect(html).not.toContain("Imagen de portada pendiente");
    expect(html).not.toContain("pendiente");
    expect(html).toContain("<svg");
    expect(html).toContain("Composición visual decorativa");
  });

  it("uses a different fallback visual per template", () => {
    const hero = createSection("hero", 0);
    const saasHtml = buildLandingHtml(docWithSections([hero], "saas_premium"));
    const luxuryHtml = buildLandingHtml(docWithSections([hero], "luxury_editorial"));
    expect(saasHtml).not.toEqual(luxuryHtml);
  });

  it("marks ai-suggested testimonials and stats with a review badge, never publishing them as verified facts silently", () => {
    const testimonials = createSection("testimonials", 0);
    testimonials.content.testimonials = [{ quote: "Excelente", name: "Cliente", role: "", source: "ai_suggested" }];
    const html = buildLandingHtml(docWithSections([testimonials]));
    expect(html).toContain("Ejemplo — revisar");
  });

  it("does not badge a user-confirmed testimonial", () => {
    const testimonials = createSection("testimonials", 0);
    testimonials.content.testimonials = [{ quote: "Excelente", name: "Cliente", role: "", source: "user_confirmed" }];
    const html = buildLandingHtml(docWithSections([testimonials]));
    expect(html).not.toContain("Ejemplo — revisar");
  });

  it("never emits a javascript: URL for CTA links", () => {
    const cta = createSection("final_cta", 0);
    cta.content.ctaHref = "javascript:alert(1)";
    const html = buildLandingHtml(docWithSections([cta]));
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain('href="#"');
  });

  it("escapes HTML in user content instead of injecting raw markup", () => {
    const hero = createSection("hero", 0);
    hero.content.title = "<script>alert(1)</script>";
    const html = buildLandingHtml(docWithSections([hero]));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("adds a noindex meta tag when seo.noindex is true", () => {
    const doc = docWithSections([createSection("hero", 0)]);
    doc.seo.noindex = true;
    expect(buildLandingHtml(doc)).toContain('name="robots" content="noindex, nofollow"');
  });

  it("omits the noindex meta tag when seo.noindex is false", () => {
    const doc = docWithSections([createSection("hero", 0)]);
    doc.seo.noindex = false;
    expect(buildLandingHtml(doc)).not.toContain("noindex");
  });

  it("orders sections by their order field regardless of array order", () => {
    const second = createSection("final_cta", 1);
    second.content.title = "Segundo";
    const first = createSection("hero", 0);
    first.content.title = "Primero";
    const html = buildLandingHtml(docWithSections([second, first]));
    expect(html.indexOf("Primero")).toBeLessThan(html.indexOf("Segundo"));
  });
});
