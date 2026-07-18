import type { ParsedSection } from "@/lib/ai/parse-sections";

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportSectionsTxt(sections: ParsedSection[], filenamePrefix: string) {
  const text = sections
    .map((s) => {
      const lines = [s.title];
      if (s.fields.subject) lines.push(`Asunto: ${s.fields.subject}`);
      if (s.fields.preview) lines.push(`Preview: ${s.fields.preview}`);
      lines.push("", s.body);
      if (s.fields.cta) lines.push("", `CTA: ${s.fields.cta}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
  downloadBlob(text, `${filenamePrefix}.txt`, "text/plain;charset=utf-8");
}

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function exportSectionsCsv(sections: ParsedSection[], filenamePrefix: string) {
  const header = ["title", "subject", "preview", "body", "cta"];
  const rows = sections.map((s) =>
    [s.title, s.fields.subject ?? "", s.fields.preview ?? "", s.body, s.fields.cta ?? ""]
      .map(csvEscape)
      .join(","),
  );
  downloadBlob(
    [header.join(","), ...rows].join("\n"),
    `${filenamePrefix}.csv`,
    "text/csv;charset=utf-8",
  );
}
