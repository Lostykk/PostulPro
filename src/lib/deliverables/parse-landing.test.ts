import { describe, expect, it } from "vitest";
import {
  emptyLandingData,
  parseLandingJson,
  serializeLandingJson,
} from "@/lib/deliverables/parse-landing";

const VALID = {
  headlines: ["H1", "H2"],
  subheadline: "Sub",
  hero: "Hero paragraph",
  features: ["F1", "F2"],
  social_proof: "Proof",
  faq: [{ q: "Q1", a: "A1" }],
  cta: "Start now",
  meta_title: "Title",
  meta_description: "Desc",
};

describe("parseLandingJson", () => {
  it("parses a clean JSON object", () => {
    const result = parseLandingJson(JSON.stringify(VALID));
    expect(result).toEqual(VALID);
  });

  it("strips ```json fences", () => {
    const result = parseLandingJson("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(result).toEqual(VALID);
  });

  it("extracts JSON wrapped in prose", () => {
    const result = parseLandingJson(
      `Aquí tenés el copy:\n${JSON.stringify(VALID)}\nEspero que te sirva.`,
    );
    expect(result).toEqual(VALID);
  });

  it("returns null for non-JSON text", () => {
    expect(parseLandingJson("esto no es JSON en absoluto")).toBeNull();
  });

  it("fills missing fields with safe defaults instead of throwing", () => {
    const result = parseLandingJson(JSON.stringify({ headlines: ["Only this"] }));
    expect(result).toEqual({ ...emptyLandingData(), headlines: ["Only this"] });
  });

  it("drops malformed faq entries instead of crashing", () => {
    const result = parseLandingJson(
      JSON.stringify({ ...VALID, faq: [{ q: "ok", a: "ok" }, { q: 5 }, "not an object"] }),
    );
    expect(result?.faq).toEqual([{ q: "ok", a: "ok" }]);
  });

  it("round-trips through serializeLandingJson", () => {
    const serialized = serializeLandingJson(VALID);
    expect(parseLandingJson(serialized)).toEqual(VALID);
  });

  // Regression: a real production generation (project
  // bcc36718-3e2c-429e-80bc-d5b21ad4de5c) didn't follow the schema in the
  // prompt at all — headlines came back as a single string, features as
  // {feature_title, feature_description} objects, social_proof as a
  // {testimonials: [...]} object, and faq items as {question, answer}. The
  // old strict-shape parser silently turned every one of those into an
  // empty default, discarding real, already-paid-for content.
  it("accepts a single headline string instead of an array", () => {
    const result = parseLandingJson(JSON.stringify({ ...VALID, headlines: "Solo un headline" }));
    expect(result?.headlines).toEqual(["Solo un headline"]);
  });

  it("accepts {feature_title, feature_description} feature objects", () => {
    const result = parseLandingJson(
      JSON.stringify({
        ...VALID,
        features: [{ feature_title: "Rápido", feature_description: "En segundos" }],
      }),
    );
    expect(result?.features).toEqual(["Rápido: En segundos"]);
  });

  it("accepts {question, answer} faq items", () => {
    const result = parseLandingJson(
      JSON.stringify({ ...VALID, faq: [{ question: "¿Funciona?", answer: "Sí" }] }),
    );
    expect(result?.faq).toEqual([{ q: "¿Funciona?", a: "Sí" }]);
  });

  it("accepts a {testimonials:[...]} object for social_proof", () => {
    const result = parseLandingJson(
      JSON.stringify({
        ...VALID,
        social_proof: { testimonials: [{ name: "Ana", title: "CEO", quote: "Excelente" }] },
      }),
    );
    expect(result?.social_proof).toBe('"Excelente" — Ana, CEO');
  });
});
