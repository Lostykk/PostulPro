import { describe, expect, it } from "vitest";
import type jsPDF from "jspdf";
import { buildReportPdf } from "@/lib/pdf-export";

const SAMPLE = `## Resumen Ejecutivo

Esto es **texto en negrita** y esto es *texto en cursiva* dentro de un párrafo normal.

## Modelo de Negocio

- Primer beneficio
- Segundo beneficio
- Tercer beneficio

1. Paso uno
2. Paso dos

> Una cita importante del negocio.

---

## Plan Financiero

| Mes | Ingresos |
|-----|----------|
| 1   | 1000     |
| 6   | 5000     |

## Próximos Pasos

Texto final del documento.`;

function pagesRawContent(doc: jsPDF): string {
  // jsPDF keeps each page's uncompressed content-stream commands in
  // internal.pages before output — inspecting it lets us confirm we drew
  // real "(texto en negrita) Tj" operators, never the literal "**" markup.
  const pages = (doc as unknown as { internal: { pages: string[][] } }).internal.pages;
  return pages.map((p) => p.join("\n")).join("\n");
}

describe("buildReportPdf", () => {
  it("renders a multi-section document without throwing and produces multiple pages (cover + TOC + content)", () => {
    let doc: jsPDF | undefined;
    expect(() => {
      doc = buildReportPdf("Business Plan de prueba", SAMPLE, { projectTitle: "Proyecto X" });
    }).not.toThrow();
    expect(doc!.getNumberOfPages()).toBeGreaterThanOrEqual(3);
  });

  it("never draws literal markdown syntax as visible text", () => {
    const doc = buildReportPdf("Business Plan de prueba", SAMPLE);
    const raw = pagesRawContent(doc);
    expect(raw).not.toContain("**texto en negrita**");
    expect(raw).not.toContain("## Resumen Ejecutivo");
    expect(raw).not.toContain("---");
    expect(raw).not.toContain("- Primer beneficio");
  });

  it("draws the actual heading and body text somewhere in the document", () => {
    const doc = buildReportPdf("Business Plan de prueba", SAMPLE);
    const raw = pagesRawContent(doc);
    // Words are drawn as individual Tj operators (so mixed bold/italic runs
    // can wrap independently) rather than one contiguous string per line.
    expect(raw).toContain("Resumen");
    expect(raw).toContain("Ejecutivo");
    expect(raw).toContain("negrita");
    expect(raw).toContain("Primer");
    expect(raw).toContain("beneficio");
  });

  it("sets PDF metadata (title/author/project) without throwing", () => {
    const doc = buildReportPdf("Mi Plan", SAMPLE, { projectTitle: "Mi Proyecto", author: "PostulPro" });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
  });

  it("handles a document with no headings at all without crashing (no TOC needed)", () => {
    expect(() => buildReportPdf("Plano", "Solo un párrafo de texto sin encabezados.")).not.toThrow();
  });
});
