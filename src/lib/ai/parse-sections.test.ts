import { describe, expect, it } from "vitest";
import { parseSections, serializeSections } from "@/lib/ai/parse-sections";

describe("parseSections / serializeSections", () => {
  it("parses multiple ===TITLE=== blocks with fields and body", () => {
    const text = `===EMAIL 1===
SUBJECT: Asunto uno
PREVIEW: Preview uno
BODY:
Cuerpo del email uno.

===EMAIL 2===
SUBJECT: Asunto dos
BODY:
Cuerpo del email dos.`;
    const sections = parseSections(text);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toEqual({
      title: "EMAIL 1",
      fields: { subject: "Asunto uno", preview: "Preview uno" },
      body: "Cuerpo del email uno.",
    });
    expect(sections[1].title).toBe("EMAIL 2");
  });

  it("returns an empty array when there are no === blocks", () => {
    expect(parseSections("texto plano sin bloques")).toEqual([]);
  });

  it("round-trips edited sections through serializeSections", () => {
    const sections = parseSections(`===EMAIL 1===
SUBJECT: Asunto
BODY:
Cuerpo.`);
    const edited = [{ ...sections[0], body: "Cuerpo editado." }];
    const reparsed = parseSections(serializeSections(edited));
    expect(reparsed).toEqual(edited);
  });

  // Regression: a real production generation (project
  // bcc36718-3e2c-429e-80bc-d5b21ad4de5c, sales-email step) used "Asunto:"
  // instead of the requested "SUBJECT:" and had no "BODY:" marker at all —
  // the old ALL-CAPS-only regex matched nothing, so the whole email
  // (subject included) collapsed into undifferentiated body text.
  it("recognizes the Spanish 'Asunto:' subject label with no BODY: marker", () => {
    const sections = parseSections(`===EMAIL 1A===
Asunto: ¿Listo para destacar?

Hola [Nombre],

Cuerpo real del email aquí.

Saludos,
[Tu Nombre]`);
    expect(sections).toHaveLength(1);
    expect(sections[0].fields.subject).toBe("¿Listo para destacar?");
    expect(sections[0].body).toContain("Cuerpo real del email aquí.");
    expect(sections[0].body).not.toContain("Asunto:");
  });

  it("does not misfire the loose Spanish-label match on ordinary prose containing a colon", () => {
    const sections = parseSections(`===EMAIL 1===
Nota importante: revisá esto antes de enviar.
Resto del cuerpo.`);
    expect(sections[0].fields).toEqual({});
    expect(sections[0].body).toContain("Nota importante: revisá esto antes de enviar.");
  });
});
