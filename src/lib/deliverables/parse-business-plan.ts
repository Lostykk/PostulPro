// Splits/joins the markdown ("## Heading" per section) that business-plan
// (and other plain "text" deliverables with the same convention) already
// produce today — see step-prompts.server.ts's businessPlan() builder. Lets
// the UI show a section index + per-section copy/edit instead of one giant
// <pre> blob, without changing what the model is asked to produce.

export type MarkdownSection = { heading: string; body: string };

// Text before the first "## " heading (if any) is kept as an unlabeled
// leading section so nothing the model wrote is ever silently dropped.
export function parseMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let heading = "";
  let buf: string[] = [];

  function flush() {
    const body = buf.join("\n").trim();
    if (heading || body) sections.push({ heading, body });
    buf = [];
  }

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      flush();
      heading = m[1];
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

export function serializeMarkdownSections(sections: MarkdownSection[]): string {
  return sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.body}` : s.body))
    .join("\n\n")
    .trim();
}
