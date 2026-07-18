// Parses the "===TITLE===\nKEY: value\nBODY:\n...text..." convention we ask
// models to follow for multi-part tool output (sales sequences, social packs,
// email sequences). Keeping one parser shared across those tools avoids each
// one reinventing slightly different regexes.
export type ParsedSection = {
  title: string;
  fields: Record<string, string>;
  body: string;
};

export function parseSections(text: string): ParsedSection[] {
  const parts = text.split(/^===\s*(.+?)\s*===\s*$/m);
  const sections: ParsedSection[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim();
    const content = (parts[i + 1] ?? "").trim();
    const { fields, body } = splitFields(content);
    sections.push({ title, fields, body });
  }
  return sections;
}

// A real production generation used "Asunto:" instead of the requested
// "SUBJECT:" — the model doesn't reliably follow the ALL-CAPS English
// convention from the prompt. The strict regex below is tried first and is
// unchanged (zero risk to existing ALL-CAPS content); a small explicit
// whitelist of Spanish synonyms is tried second so real-world field labels
// still get separated into subject/preview/cta instead of collapsing into
// one undifferentiated body — a loose "any Capitalized Phrase:" match would
// misfire on ordinary prose, so only these known labels are recognized.
const FIELD_SYNONYMS: Record<string, string> = {
  subject: "subject",
  asunto: "subject",
  preview: "preview",
  "vista previa": "preview",
  previsualizacion: "preview",
  cta: "cta",
  "llamado a la accion": "cta",
  "llamada a la accion": "cta",
};
const BODY_LABELS = new Set(["body", "cuerpo"]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matchFieldLine(line: string): { norm: string; value: string } | null {
  const strict = line.match(/^([A-Z][A-Z_]*):\s?(.*)$/);
  if (strict) return { norm: strict[1].toLowerCase(), value: strict[2].trim() };
  const loose = line.match(/^([\p{L} ]{2,25}):\s?(.*)$/u);
  if (loose) {
    const norm = stripAccents(loose[1]).toLowerCase().trim().replace(/\s+/g, " ");
    if (norm in FIELD_SYNONYMS || BODY_LABELS.has(norm)) return { norm, value: loose[2].trim() };
  }
  return null;
}

function splitFields(content: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = matchFieldLine(lines[i]);
    if (!m || BODY_LABELS.has(m.norm)) break;
    fields[FIELD_SYNONYMS[m.norm] ?? m.norm] = m.value;
    i++;
  }
  const marker = matchFieldLine(lines[i] ?? "");
  if (marker && BODY_LABELS.has(marker.norm) && marker.value === "") i++;
  const body = lines.slice(i).join("\n").trim();
  return { fields, body };
}

// Inverse of parseSections — recomposes edited sections back into the same
// "===TITLE===\nKEY: value\nBODY:\n...text..." text so it round-trips
// losslessly through generations.edited_output and re-parses identically
// after a refresh.
export function serializeSections(sections: ParsedSection[]): string {
  return sections
    .map((s) => {
      const fieldLines = Object.entries(s.fields)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${k.toUpperCase()}: ${v}`);
      const parts = [`===${s.title}===`, ...fieldLines];
      if (s.body) parts.push("BODY:", s.body);
      return parts.join("\n");
    })
    .join("\n\n");
}
