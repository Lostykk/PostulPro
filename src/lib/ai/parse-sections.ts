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

function splitFields(content: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {};
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^([A-Z][A-Z_]*):\s?(.*)$/);
    if (m && m[1] !== "BODY") {
      fields[m[1].toLowerCase()] = m[2].trim();
      i++;
      continue;
    }
    break;
  }
  if (/^BODY:\s*$/.test(lines[i] ?? "")) i++;
  const body = lines.slice(i).join("\n").trim();
  return { fields, body };
}
