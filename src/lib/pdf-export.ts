import jsPDF from "jspdf";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent, PhrasingContent, Table, List, ListItem, Blockquote, Heading, Paragraph } from "mdast";

// Renders markdown into a real, professional PDF — headings, bold/italic,
// lists, tables, blockquotes and horizontal rules are drawn as actual PDF
// primitives instead of leaving "**"/"###"/"---" as literal characters (the
// old implementation just scanned for "#"/"##" line prefixes and printed
// everything else verbatim). Reuses remark-parse + remark-gfm (already
// dependencies of RichContentRenderer) so the PDF and the on-screen "Ver"
// view are driven by the exact same markdown AST.

export type PdfExportOptions = {
  projectTitle?: string;
  author?: string;
};

const PAGE = { unit: "pt" as const, format: "a4" as const };
const MARGIN = 48;
const BRAND = { r: 124, g: 58, b: 237 };
const INK = { r: 20, g: 20, b: 30 };
const MUTED = { r: 110, g: 110, b: 125 };

type TocEntry = { text: string; depth: number; page: number };

type Layout = {
  doc: jsPDF;
  pageWidth: number;
  pageHeight: number;
  maxWidth: number;
  y: number;
};

function newLayout(doc: jsPDF): Layout {
  return {
    doc,
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    maxWidth: doc.internal.pageSize.getWidth() - MARGIN * 2,
    y: MARGIN,
  };
}

function ensureSpace(layout: Layout, needed: number) {
  if (layout.y + needed > layout.pageHeight - MARGIN) {
    layout.doc.addPage();
    layout.y = MARGIN;
  }
}

// --- inline runs (bold/italic) -------------------------------------------

type Run = { text: string; bold: boolean; italic: boolean; code: boolean };

function flattenInline(nodes: PhrasingContent[], bold = false, italic = false, code = false): Run[] {
  const runs: Run[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      runs.push({ text: node.value, bold, italic, code });
    } else if (node.type === "strong") {
      runs.push(...flattenInline(node.children, true, italic, code));
    } else if (node.type === "emphasis") {
      runs.push(...flattenInline(node.children, bold, true, code));
    } else if (node.type === "inlineCode") {
      runs.push({ text: node.value, bold, italic, code: true });
    } else if (node.type === "link") {
      runs.push(...flattenInline(node.children, bold, italic, code));
    } else if (node.type === "break") {
      runs.push({ text: "\n", bold, italic, code });
    } else if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
      runs.push(...flattenInline((node as { children: PhrasingContent[] }).children, bold, italic, code));
    }
  }
  return runs;
}

function fontStyleFor(bold: boolean, italic: boolean): string {
  if (bold && italic) return "bolditalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "normal";
}

// Draws wrapped text made of mixed bold/italic/code runs starting at (x, layout.y),
// re-flowing across page breaks. Returns nothing — mutates layout.y.
function drawRuns(layout: Layout, runs: Run[], x: number, indentWidth: number, fontSize: number, lineHeight: number) {
  const { doc } = layout;
  const rightEdge = MARGIN + layout.maxWidth;
  let cursorX = x;
  ensureSpace(layout, lineHeight);

  const words: { text: string; bold: boolean; italic: boolean; code: boolean; newline?: boolean }[] = [];
  for (const run of runs) {
    if (run.text === "\n") {
      words.push({ text: "", bold: run.bold, italic: run.italic, code: run.code, newline: true });
      continue;
    }
    for (const w of run.text.split(/(\s+)/).filter((w) => w.length > 0)) {
      words.push({ text: w, bold: run.bold, italic: run.italic, code: run.code });
    }
  }

  for (const w of words) {
    if (w.newline) {
      layout.y += lineHeight;
      cursorX = x;
      ensureSpace(layout, lineHeight);
      continue;
    }
    if (/^\s+$/.test(w.text)) {
      doc.setFont(w.code ? "courier" : "helvetica", "normal");
      doc.setFontSize(fontSize);
      cursorX += doc.getTextWidth(" ");
      continue;
    }
    doc.setFont(w.code ? "courier" : "helvetica", fontStyleFor(w.bold, w.italic));
    doc.setFontSize(fontSize);
    const width = doc.getTextWidth(w.text);
    if (cursorX + width > rightEdge && cursorX > x) {
      layout.y += lineHeight;
      cursorX = x;
      ensureSpace(layout, lineHeight);
    }
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(w.text, cursorX, layout.y);
    cursorX += width;
  }
  layout.y += lineHeight;
}

// --- block rendering -------------------------------------------------------

function renderHeading(layout: Layout, node: Heading, toc: TocEntry[]) {
  const sizes: Record<number, number> = { 1: 20, 2: 16, 3: 13, 4: 11.5 };
  const fontSize = sizes[node.depth] ?? 11;
  const lineHeight = fontSize * 1.3;
  ensureSpace(layout, lineHeight + 24); // keep-with-next heuristic
  layout.y += node.depth <= 2 ? 14 : 8;
  const text = flattenInline(node.children)
    .map((r) => r.text)
    .join("")
    .trim();
  if (node.depth <= 2 && text) {
    toc.push({ text, depth: node.depth, page: layout.doc.getNumberOfPages() });
  }
  layout.doc.setFont("helvetica", "bold");
  layout.doc.setFontSize(fontSize);
  layout.doc.setTextColor(node.depth === 1 ? BRAND.r : INK.r, node.depth === 1 ? BRAND.g : INK.g, node.depth === 1 ? BRAND.b : INK.b);
  const wrapped = layout.doc.splitTextToSize(text, layout.maxWidth) as string[];
  for (const line of wrapped) {
    ensureSpace(layout, lineHeight);
    layout.doc.text(line, MARGIN, layout.y);
    layout.y += lineHeight;
  }
  layout.y += 4;
}

function renderParagraph(layout: Layout, node: Paragraph, indent = 0) {
  const runs = flattenInline(node.children);
  if (runs.every((r) => r.text.trim() === "")) return;
  drawRuns(layout, runs, MARGIN + indent, indent, 10.5, 15);
}

function renderList(layout: Layout, node: List, depth: number) {
  let index = node.start ?? 1;
  for (const item of node.children as ListItem[]) {
    renderListItem(layout, item, depth, node.ordered ? index : null);
    if (node.ordered) index++;
  }
}

function renderListItem(layout: Layout, item: ListItem, depth: number, ordinal: number | null) {
  const indent = 16 * (depth + 1);
  const marker = ordinal !== null ? `${ordinal}.` : "•";
  ensureSpace(layout, 15);
  layout.doc.setFont("helvetica", "normal");
  layout.doc.setFontSize(10.5);
  layout.doc.setTextColor(INK.r, INK.g, INK.b);
  layout.doc.text(marker, MARGIN + indent - 14, layout.y);
  let first = true;
  for (const child of item.children) {
    if (child.type === "paragraph") {
      if (!first) layout.y += 2;
      renderParagraph(layout, child, indent);
      first = false;
    } else if (child.type === "list") {
      renderList(layout, child, depth + 1);
    }
  }
}

function renderBlockquote(layout: Layout, node: Blockquote) {
  const startY = layout.y;
  const indent = 18;
  ensureSpace(layout, 15);
  layout.doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  for (const child of node.children) {
    if (child.type === "paragraph") {
      const runs = flattenInline(child.children).map((r) => ({ ...r, italic: true }));
      drawRuns(layout, runs, MARGIN + indent, indent, 10.5, 15);
    }
  }
  layout.doc.setDrawColor(MUTED.r, MUTED.g, MUTED.b);
  layout.doc.setLineWidth(2);
  layout.doc.line(MARGIN + 4, startY - 10, MARGIN + 4, layout.y - 8);
  layout.doc.setTextColor(INK.r, INK.g, INK.b);
}

function renderThematicBreak(layout: Layout) {
  ensureSpace(layout, 20);
  layout.y += 8;
  layout.doc.setDrawColor(210, 210, 220);
  layout.doc.setLineWidth(1);
  layout.doc.line(MARGIN, layout.y, MARGIN + layout.maxWidth, layout.y);
  layout.y += 16;
}

function renderTable(layout: Layout, node: Table) {
  const rows = node.children;
  if (rows.length === 0) return;
  const colCount = rows[0].children.length;
  const colWidth = layout.maxWidth / colCount;
  const lineHeight = 13;
  const cellPad = 5;

  rows.forEach((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    const cellLines = row.children.map((cell) => {
      const text = flattenInline(cell.children)
        .map((r) => r.text)
        .join("");
      return layout.doc.splitTextToSize(text, colWidth - cellPad * 2) as string[];
    });
    const rowHeight = Math.max(...cellLines.map((l) => l.length), 1) * lineHeight + cellPad * 2;
    ensureSpace(layout, rowHeight);
    const rowTop = layout.y;

    if (isHeader) {
      layout.doc.setFillColor(245, 243, 255);
      layout.doc.rect(MARGIN, rowTop, layout.maxWidth, rowHeight, "F");
    }
    layout.doc.setDrawColor(220, 220, 230);
    for (let c = 0; c <= colCount; c++) {
      const x = MARGIN + colWidth * c;
      layout.doc.line(x, rowTop, x, rowTop + rowHeight);
    }
    layout.doc.line(MARGIN, rowTop, MARGIN + layout.maxWidth, rowTop);
    layout.doc.line(MARGIN, rowTop + rowHeight, MARGIN + layout.maxWidth, rowTop + rowHeight);

    layout.doc.setFont("helvetica", isHeader ? "bold" : "normal");
    layout.doc.setFontSize(9.5);
    layout.doc.setTextColor(INK.r, INK.g, INK.b);
    cellLines.forEach((lines, c) => {
      lines.forEach((line, li) => {
        layout.doc.text(line, MARGIN + colWidth * c + cellPad, rowTop + cellPad + 9 + li * lineHeight);
      });
    });
    layout.y = rowTop + rowHeight;
  });
  layout.y += 10;
}

function renderBlock(layout: Layout, node: RootContent, toc: TocEntry[]) {
  switch (node.type) {
    case "heading":
      renderHeading(layout, node, toc);
      break;
    case "paragraph":
      renderParagraph(layout, node);
      layout.y += 4;
      break;
    case "list":
      renderList(layout, node, 0);
      layout.y += 4;
      break;
    case "blockquote":
      renderBlockquote(layout, node);
      layout.y += 8;
      break;
    case "thematicBreak":
      renderThematicBreak(layout);
      break;
    case "table":
      renderTable(layout, node);
      break;
    case "code": {
      ensureSpace(layout, 16);
      layout.doc.setFont("courier", "normal");
      layout.doc.setFontSize(9);
      const wrapped = layout.doc.splitTextToSize(node.value, layout.maxWidth) as string[];
      for (const line of wrapped) {
        ensureSpace(layout, 13);
        layout.doc.text(line, MARGIN, layout.y);
        layout.y += 13;
      }
      layout.y += 8;
      break;
    }
    default:
      break;
  }
}

// --- cover / footer chrome --------------------------------------------------

function drawCoverPage(doc: jsPDF, title: string, options?: PdfExportOptions) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFillColor(BRAND.r, BRAND.g, BRAND.b);
  doc.rect(0, 0, pageWidth, pageHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("PostulPro", MARGIN, 60);
  doc.setFontSize(26);
  const titleLines = doc.splitTextToSize(title, pageWidth - MARGIN * 2) as string[];
  doc.text(titleLines, MARGIN, pageHeight / 2 - (titleLines.length * 15));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  if (options?.projectTitle) {
    doc.text(options.projectTitle, MARGIN, pageHeight / 2 + 20 + titleLines.length * 4);
  }
  doc.setFontSize(10);
  doc.text(
    new Date().toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" }),
    MARGIN,
    pageHeight - 60,
  );
}

function drawFooterChrome(doc: jsPDF, page: number, totalPages: number, title: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED.r, MUTED.g, MUTED.b);
  doc.text(title.slice(0, 60), MARGIN, 24);
  doc.text("PostulPro", pageWidth - MARGIN, 24, { align: "right" });
  doc.setDrawColor(230, 230, 235);
  doc.line(MARGIN, 32, pageWidth - MARGIN, 32);
  doc.text(`Página ${page - 1} de ${totalPages - 1}`, pageWidth / 2, pageHeight - 24, { align: "center" });
}

function slugifyFilename(title: string): string {
  return `postulpro-${title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}.pdf`;
}

// Builds the document without triggering a browser download — the part
// that's actually worth unit-testing (pagination, TOC, no-literal-markdown
// invariants). exportReportPdf() below is the thin side-effecting wrapper
// real call sites use.
export function buildReportPdf(title: string, content: string, options?: PdfExportOptions): jsPDF {
  const doc = new jsPDF(PAGE);
  doc.setProperties({
    title,
    subject: options?.projectTitle ?? "",
    author: options?.author ?? "PostulPro",
    creator: "PostulPro",
  });

  drawCoverPage(doc, title, options);
  doc.addPage(); // reserved for the table of contents, filled in below

  doc.addPage();
  const layout = newLayout(doc);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(content) as Root;
  const toc: TocEntry[] = [];
  for (const node of tree.children) {
    renderBlock(layout, node, toc);
  }

  const totalPages = doc.getNumberOfPages();

  // Fill in the TOC page reserved earlier, now that every heading's real
  // page number is known.
  if (toc.length > 0) {
    doc.setPage(2);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Índice", MARGIN, 70);
    let y = 100;
    doc.setFontSize(10.5);
    for (const entry of toc) {
      doc.setFont("helvetica", entry.depth === 1 ? "bold" : "normal");
      const indent = (entry.depth - 1) * 14;
      const label = doc.splitTextToSize(entry.text, doc.internal.pageSize.getWidth() - MARGIN * 2 - indent - 30)[0] as string;
      doc.text(label, MARGIN + indent, y);
      doc.text(String(entry.page - 1), doc.internal.pageSize.getWidth() - MARGIN, y, { align: "right" });
      y += 18;
      if (y > doc.internal.pageSize.getHeight() - MARGIN) break; // single-page TOC is enough for real business-plan lengths
    }
  }

  for (let p = 2; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooterChrome(doc, p, totalPages, title);
  }

  return doc;
}

export function exportReportPdf(title: string, content: string, options?: PdfExportOptions) {
  const doc = buildReportPdf(title, content, options);
  doc.save(slugifyFilename(title));
}
