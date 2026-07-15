import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  callModel,
  callModelOnce,
  logModelUsage,
  type ModelUsage,
} from "@/lib/ai/call-model.server";
import type { ToolConfig } from "@/lib/ai/tools-config.server";

const ANTHROPIC_TOOL: ToolConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  credits: 5,
  maxTokens: 8000,
  systemPrompt: "test system prompt",
};

const OPENAI_TOOL: ToolConfig = {
  provider: "openai",
  model: "gpt-4o",
  credits: 1,
  maxTokens: 1200,
  systemPrompt: "test system prompt",
};

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  body?: ReadableStream<Uint8Array> | null;
  text?: () => Promise<string>;
}) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    body: response.body ?? null,
    text: response.text ?? (async () => ""),
  });
}

const ENV_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

describe("callModel — missing key (fails closed before any network call)", () => {
  it("throws a clean error for Anthropic without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(callModel(ANTHROPIC_TOOL, "prompt", () => {})).rejects.toThrow(
      "ANTHROPIC_API_KEY not configured",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws a clean error for OpenAI without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(callModel(OPENAI_TOOL, "prompt", () => {})).rejects.toThrow(
      "OPENAI_API_KEY not configured",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("callModel — Anthropic streaming", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  });

  it("collects deltas and real usage from message_start/message_delta events", async () => {
    const stream = sseStream([
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 42, output_tokens: 0 } } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Hola" } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: " mundo" } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 7 } })}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));

    let full = "";
    let usage: ModelUsage | null = null;
    await callModel(
      ANTHROPIC_TOOL,
      "idea",
      (d) => (full += d),
      undefined,
      (u) => (usage = u),
    );

    expect(full).toBe("Hola mundo");
    expect(usage).toEqual({ inputTokens: 42, outputTokens: 7, stopReason: null });
  });

  it("captures stop_reason from message_delta (e.g. truncation by max_tokens)", async () => {
    const stream = sseStream([
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "{" } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 6000 } })}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));
    let usage: ModelUsage | null = null;
    await callModel(ANTHROPIC_TOOL, "idea", () => {}, undefined, (u) => (usage = u));
    expect(usage).toEqual({ inputTokens: null, outputTokens: 6000, stopReason: "max_tokens" });
  });

  it("reports a natural stop_reason (end_turn) distinctly from a truncated one", async () => {
    const stream = sseStream([
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } })}\n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));
    let usage: ModelUsage | null = null;
    await callModel(ANTHROPIC_TOOL, "idea", () => {}, undefined, (u) => (usage = u));
    expect(usage).toEqual({ inputTokens: null, outputTokens: 3, stopReason: "end_turn" });
  });

  it("surfaces the HTTP status and truncated body on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ ok: false, status: 401, body: null, text: async () => "invalid x-api-key" }),
    );
    await expect(callModel(ANTHROPIC_TOOL, "idea", () => {})).rejects.toThrow(/Anthropic 401/);
  });

  it("surfaces 429 without retrying (no hidden extra provider calls)", async () => {
    const fetchSpy = mockFetchOnce({
      ok: false,
      status: 429,
      body: null,
      text: async () => "rate limited",
    });
    vi.stubGlobal("fetch", fetchSpy);
    await expect(callModel(ANTHROPIC_TOOL, "idea", () => {})).rejects.toThrow(/Anthropic 429/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces 500 the same way as any other non-ok status", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ ok: false, status: 500, body: null, text: async () => "" }),
    );
    await expect(callModel(ANTHROPIC_TOOL, "idea", () => {})).rejects.toThrow(/Anthropic 500/);
  });

  it("tolerates a malformed/truncated SSE line without crashing the stream", async () => {
    const stream = sseStream([
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n`,
      `data: {not valid json\n\n`,
      `not-a-data-line\n\n`,
      `data: \n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));
    let full = "";
    await expect(callModel(ANTHROPIC_TOOL, "idea", (d) => (full += d))).resolves.toBeUndefined();
    expect(full).toBe("ok");
  });

  it("propagates client abort as a rejection (fetch never silently swallows it)", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );
    const callPromise = callModel(ANTHROPIC_TOOL, "idea", () => {}, controller.signal);
    controller.abort();
    await expect(callPromise).rejects.toThrow();
  });

  it("reports null usage fields (not zeros, not a guess) when the provider never sends them", async () => {
    const stream = sseStream([
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}\n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));
    let usage: ModelUsage | null = null;
    await callModel(
      ANTHROPIC_TOOL,
      "idea",
      () => {},
      undefined,
      (u) => (usage = u),
    );
    expect(usage).toEqual({ inputTokens: null, outputTokens: null, stopReason: null });
  });
});

describe("callModel — OpenAI streaming", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key-not-real";
  });

  it("requests stream_options.include_usage and reads usage from the final chunk", async () => {
    const stream = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " there" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    const fetchSpy = mockFetchOnce({ ok: true, status: 200, body: stream });
    vi.stubGlobal("fetch", fetchSpy);

    let full = "";
    let usage: ModelUsage | null = null;
    await callModel(
      OPENAI_TOOL,
      "idea",
      (d) => (full += d),
      undefined,
      (u) => (usage = u),
    );

    expect(full).toBe("Hi there");
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 3, stopReason: null });
    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.stream_options).toEqual({ include_usage: true });
  });

  it("surfaces a 401 the same way as Anthropic", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ ok: false, status: 401, body: null, text: async () => "invalid_api_key" }),
    );
    await expect(callModel(OPENAI_TOOL, "idea", () => {})).rejects.toThrow(/OpenAI 401/);
  });

  it("captures finish_reason=length as the stop reason when OpenAI truncates", async () => {
    const stream = sseStream([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 1200 } })}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));
    let usage: ModelUsage | null = null;
    await callModel(OPENAI_TOOL, "idea", () => {}, undefined, (u) => (usage = u));
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 1200, stopReason: "length" });
  });
});

describe("callModelOnce", () => {
  it("concatenates every delta into the full text and forwards usage", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const stream = sseStream([
      `data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ab"}}\n\n`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"cd"}}\n\n`,
    ]);
    vi.stubGlobal("fetch", mockFetchOnce({ ok: true, status: 200, body: stream }));
    let usage: ModelUsage | null = null;
    const result = await callModelOnce(ANTHROPIC_TOOL, "idea", undefined, (u) => (usage = u));
    expect(result).toBe("abcd");
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 0, stopReason: null });
  });
});

describe("logModelUsage — safe telemetry", () => {
  it("logs only structured, non-sensitive fields — never prompt/output content", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logModelUsage({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      operation: "project_step",
      toolKey: "business-plan",
      usage: { inputTokens: 100, outputTokens: 50, stopReason: "end_turn" },
      durationMs: 1234,
      status: "success",
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      scope: "ai_model_call",
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      operation: "project_step",
      toolKey: "business-plan",
      inputTokens: 100,
      outputTokens: 50,
      stopReason: "end_turn",
      durationMs: 1234,
      status: "success",
      // errorCode: undefined is correctly dropped by JSON.stringify, not logged.
    });
    // The logged payload's keys are an exhaustive, known-safe allowlist —
    // this fails if anyone ever adds a "prompt" or "output" field.
    expect(Object.keys(logged).sort()).toEqual(
      [
        "durationMs",
        "inputTokens",
        "model",
        "operation",
        "outputTokens",
        "provider",
        "scope",
        "status",
        "stopReason",
        "toolKey",
      ].sort(),
    );
    logSpy.mockRestore();
  });
});
