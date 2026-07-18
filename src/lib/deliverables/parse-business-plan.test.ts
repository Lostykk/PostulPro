import { describe, expect, it } from "vitest";
import {
  isDegenerateSection,
  parseMarkdownSections,
  serializeMarkdownSections,
} from "@/lib/deliverables/parse-business-plan";

describe("parseMarkdownSections", () => {
  it("splits on ## headings", () => {
    const md = "## Resumen Ejecutivo\nTexto uno.\n\n## Roadmap\nTexto dos.";
    expect(parseMarkdownSections(md)).toEqual([
      { heading: "Resumen Ejecutivo", body: "Texto uno." },
      { heading: "Roadmap", body: "Texto dos." },
    ]);
  });

  it("keeps text before the first heading as an unlabeled leading section", () => {
    const md = "Intro sin encabezado.\n\n## Resumen Ejecutivo\nTexto.";
    const sections = parseMarkdownSections(md);
    expect(sections[0]).toEqual({ heading: "", body: "Intro sin encabezado." });
    expect(sections[1]).toEqual({ heading: "Resumen Ejecutivo", body: "Texto." });
  });

  it("handles a single section with no heading at all", () => {
    expect(parseMarkdownSections("Solo texto plano, sin secciones.")).toEqual([
      { heading: "", body: "Solo texto plano, sin secciones." },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseMarkdownSections("")).toEqual([]);
  });

  it("round-trips through serializeMarkdownSections", () => {
    const md = "## Resumen Ejecutivo\nTexto uno.\n\n## Roadmap\nTexto dos.";
    expect(serializeMarkdownSections(parseMarkdownSections(md))).toBe(md);
  });
});

describe("isDegenerateSection", () => {
  it("flags a section whose body is only a horizontal rule", () => {
    expect(isDegenerateSection({ heading: "Separador", body: "---" })).toBe(true);
    expect(isDegenerateSection({ heading: "Separador", body: "***" })).toBe(true);
    expect(isDegenerateSection({ heading: "Separador", body: "- - -" })).toBe(true);
    expect(isDegenerateSection({ heading: "Separador", body: "   " })).toBe(true);
    expect(isDegenerateSection({ heading: "Separador", body: "" })).toBe(true);
  });

  it("does not flag a section with real content", () => {
    expect(isDegenerateSection({ heading: "Roadmap", body: "Mes 1: lanzamiento." })).toBe(false);
  });
});
