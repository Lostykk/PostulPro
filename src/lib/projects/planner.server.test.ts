import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as callModelModule from "@/lib/ai/call-model.server";
import { generateProjectPlan, PlannerError } from "@/lib/projects/planner.server";
import type { ModelUsage } from "@/lib/ai/call-model.server";

// Regression coverage for "No pudimos interpretar el plan generado" — the
// root cause was a too-tight maxTokens (6000) for a much larger schema than
// any single tool's output, combined with never reading the provider's own
// stop_reason, so a truncated response and any other parse failure were
// indistinguishable and got one identical, blind retry. These tests drive
// generateProjectPlan() through a mocked callModelOnce so every failure mode
// is reproduced deterministically, without a real network call.

const VALID_RESPONSE = {
  brief: { name: "Test Brief" },
  plan: {
    title: "Plan de prueba",
    deliverables: [{ toolKey: "copywriter", title: "Post de LinkedIn", description: "Un post breve" }],
  },
};

function mockModelOnce(
  responses: Array<{ text: string; stopReason: string | null }>,
): ReturnType<typeof vi.spyOn> {
  let call = 0;
  return vi
    .spyOn(callModelModule, "callModelOnce")
    .mockImplementation(async (_tool, _prompt, _signal, onUsage) => {
      const r = responses[Math.min(call, responses.length - 1)];
      call++;
      const usage: ModelUsage = { inputTokens: 10, outputTokens: 20, stopReason: r.stopReason };
      onUsage?.(usage);
      return r.text;
    });
}

const BASE_INPUT = { idea: "Quiero lanzar un curso online de fotografía", language: "es", plan: "free" as const };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateProjectPlan — valid responses", () => {
  it("1. accepts a well-formed JSON response on the first try", async () => {
    const spy = mockModelOnce([{ text: JSON.stringify(VALID_RESPONSE), stopReason: "end_turn" }]);
    const result = await generateProjectPlan(BASE_INPUT);
    expect(result.plan.title).toBe("Plan de prueba");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("2. strips a ```json fenced response before parsing", async () => {
    mockModelOnce([
      { text: "```json\n" + JSON.stringify(VALID_RESPONSE) + "\n```", stopReason: "end_turn" },
    ]);
    const result = await generateProjectPlan(BASE_INPUT);
    expect(result.plan.title).toBe("Plan de prueba");
  });

  it("7. fills in missing optional fields with schema defaults instead of failing", async () => {
    // Deliberately omit every optional brief/plan field (constraints, knownFacts,
    // assumptions, objectives, reason, dependencies, input, estimatedCredits...).
    mockModelOnce([{ text: JSON.stringify(VALID_RESPONSE), stopReason: "end_turn" }]);
    const result = await generateProjectPlan(BASE_INPUT);
    expect(result.brief.constraints).toEqual([]);
    expect(result.brief.knownFacts).toEqual([]);
    expect(result.plan.deliverables[0].dependencies).toEqual([]);
  });

  it("8. extracts the JSON object even with prose before and after it", async () => {
    mockModelOnce([
      {
        text: `Acá tenés el plan:\n${JSON.stringify(VALID_RESPONSE)}\n¡Espero que te sirva!`,
        stopReason: "end_turn",
      },
    ]);
    const result = await generateProjectPlan(BASE_INPUT);
    expect(result.plan.title).toBe("Plan de prueba");
  });
});

describe("generateProjectPlan — truncation (stop_reason por límite)", () => {
  it("3 & 4. classifies a cut-off response as truncated_response specifically because stop_reason is max_tokens", async () => {
    mockModelOnce([
      { text: '{"brief": {"name": "x", "constraints": ["a", "b"', stopReason: "max_tokens" },
      { text: '{"brief": {"name": "x", "constraints": ["a", "b"', stopReason: "max_tokens" },
    ]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({
      code: "truncated_response",
    });
  });

  it("10. retries successfully after a truncated first attempt, with no duplicate final result", async () => {
    const spy = mockModelOnce([
      { text: '{"brief": {"name": "x"', stopReason: "max_tokens" },
      { text: JSON.stringify(VALID_RESPONSE), stopReason: "end_turn" },
    ]);
    const result = await generateProjectPlan(BASE_INPUT);
    expect(result.plan.title).toBe("Plan de prueba");
    expect(spy).toHaveBeenCalledTimes(2);
    // The retry prompt must tell the model to be more concise, not just
    // repeat the generic "not valid JSON" instruction.
    const secondCallPrompt = spy.mock.calls[1][1] as string;
    expect(secondCallPrompt).toMatch(/se cortó por exceder el límite/);
  });

  it("11. both attempts truncated: fails once, with exactly two model calls (no duplicate retries)", async () => {
    const spy = mockModelOnce([
      { text: '{"brief"', stopReason: "max_tokens" },
      { text: '{"brief"', stopReason: "max_tokens" },
    ]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({
      code: "truncated_response",
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("generateProjectPlan — malformed / empty / invalid-schema responses", () => {
  it("5. classifies genuinely malformed (non-truncated) JSON as json_parse_failed", async () => {
    mockModelOnce([
      { text: "esto no es json en absoluto", stopReason: "end_turn" },
      { text: "esto no es json en absoluto", stopReason: "end_turn" },
    ]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({
      code: "json_parse_failed",
    });
  });

  it("6. classifies valid JSON that fails the zod schema as schema_validation_failed", async () => {
    // Missing the required "deliverables" array entirely (min 1, no default).
    const badShape = { brief: {}, plan: { title: "Sin entregables" } };
    mockModelOnce([
      { text: JSON.stringify(badShape), stopReason: "end_turn" },
      { text: JSON.stringify(badShape), stopReason: "end_turn" },
    ]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({
      code: "schema_validation_failed",
    });
  });

  it("9. classifies a genuinely empty response as empty_response", async () => {
    mockModelOnce([
      { text: "", stopReason: "end_turn" },
      { text: "", stopReason: "end_turn" },
    ]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({ code: "empty_response" });
  });

  it("a whitespace-only response is also treated as empty, not a parse error", async () => {
    mockModelOnce([
      { text: "   \n  ", stopReason: "end_turn" },
      { text: "   \n  ", stopReason: "end_turn" },
    ]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({ code: "empty_response" });
  });
});

describe("generateProjectPlan — public messages never blame the user's idea for a technical failure", () => {
  const technicalCodes: Array<[string, Array<{ text: string; stopReason: string | null }>]> = [
    ["empty_response", [{ text: "", stopReason: "end_turn" }, { text: "", stopReason: "end_turn" }]],
    [
      "truncated_response",
      [
        { text: "{broken", stopReason: "max_tokens" },
        { text: "{broken", stopReason: "max_tokens" },
      ],
    ],
    [
      "json_parse_failed",
      [
        { text: "not json", stopReason: "end_turn" },
        { text: "not json", stopReason: "end_turn" },
      ],
    ],
  ];

  it.each(technicalCodes)("%s never suggests reformulating the idea", async (_code, responses) => {
    mockModelOnce(responses);
    try {
      await generateProjectPlan(BASE_INPUT);
      throw new Error("expected generateProjectPlan to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerError);
      expect((err as PlannerError).message.toLowerCase()).not.toMatch(/reformul/);
    }
  });

  it("provider_error (network/HTTP failure) also avoids blaming the idea and never leaks the raw error", async () => {
    vi.spyOn(callModelModule, "callModelOnce").mockRejectedValue(
      new Error("Anthropic 401: invalid x-api-key sk-ant-super-secret-value"),
    );
    try {
      await generateProjectPlan(BASE_INPUT);
      throw new Error("expected generateProjectPlan to reject");
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerError);
      const message = (err as PlannerError).message;
      expect(message.toLowerCase()).not.toMatch(/reformul/);
      expect(message).not.toMatch(/sk-ant-/);
      expect((err as PlannerError).code).toBe("provider_error");
    }
  });
});

describe("generateProjectPlan — no_valid_deliverables keeps its distinct, idea-specific message", () => {
  it("still suggests reformulating when the model proposes zero real capabilities", async () => {
    const onlyInventedTool = {
      brief: {},
      plan: {
        title: "Plan inventado",
        deliverables: [{ toolKey: "not-a-real-tool", title: "Título válido", description: "Descripción válida" }],
      },
    };
    mockModelOnce([{ text: JSON.stringify(onlyInventedTool), stopReason: "end_turn" }]);
    await expect(generateProjectPlan(BASE_INPUT)).rejects.toMatchObject({
      code: "no_valid_deliverables",
    });
  });
});
