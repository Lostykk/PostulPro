import { describe, expect, it } from "vitest";
import { buildLandingHtml } from "@/lib/landing/export";
import { createSection, emptyLandingV2 } from "@/lib/landing/schema";

function docWithSections(sections: ReturnType<typeof createSection>[]) {
  const doc = emptyLandingV2("Test landing");
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

  it("shows the explicit pending placeholder when no hero image is set", () => {
    const hero = createSection("hero", 0);
    const html = buildLandingHtml(docWithSections([hero]));
    expect(html).toContain("Imagen de portada pendiente");
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
