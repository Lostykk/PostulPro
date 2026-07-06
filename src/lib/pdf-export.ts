import jsPDF from "jspdf";

// Minimal markdown-ish (# / ##) renderer with PostulPro branding for
// exporting generated reports. Not a full markdown parser — just enough
// structure for headings + paragraphs coming out of our AI prompts.
export function exportReportPdf(title: string, content: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;

  doc.setFillColor(124, 58, 237);
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("PostulPro", margin, 30);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(title, margin, 50);

  let y = 100;
  doc.setTextColor(20, 20, 30);

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("## ")) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      const wrapped = doc.splitTextToSize(line.replace(/^##\s*/, ""), maxWidth);
      ensureSpace(wrapped.length * 16 + 10);
      y += 8;
      doc.text(wrapped, margin, y);
      y += wrapped.length * 16 + 4;
    } else if (line.startsWith("# ")) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      const wrapped = doc.splitTextToSize(line.replace(/^#\s*/, ""), maxWidth);
      ensureSpace(wrapped.length * 18 + 12);
      y += 10;
      doc.text(wrapped, margin, y);
      y += wrapped.length * 18 + 6;
    } else if (line.trim() === "") {
      y += 8;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(line, maxWidth);
      ensureSpace(wrapped.length * 13 + 4);
      doc.text(wrapped, margin, y);
      y += wrapped.length * 13 + 4;
    }
  }

  const filename = `postulpro-${title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}.pdf`;
  doc.save(filename);
}
