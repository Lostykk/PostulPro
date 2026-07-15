import type { ToolConfig } from "@/lib/ai/tools-config.server";

// Shared Anthropic/OpenAI streaming caller. Extracted out of
// routes/api/generate-ai.ts so both the single-tool endpoint and the AI
// Project Builder's step executor use the exact same provider-calling
// code — no behavior fork between the two callers.

// Real token counts as reported by the provider itself — never derived
// from output length. `onUsage` fires at most once, after the stream ends,
// with whatever the provider actually reported (either field may be null
// if a given provider/response never included it). `stopReason` is the
// provider's own reason the generation ended (e.g. "end_turn"/"stop" for a
// natural finish, "max_tokens"/"length" when the output was cut off by the
// token limit) — callers that need to distinguish a truncated response from
// a malformed-but-complete one (the planner) rely on this being accurate,
// never inferred from response length.
export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
};

export async function callModel(
  tool: ToolConfig,
  prompt: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onUsage?: (usage: ModelUsage) => void,
): Promise<void> {
  if (tool.provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY not configured");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: tool.model,
        max_tokens: tool.maxTokens,
        system: tool.systemPrompt,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
    }
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let stopReason: string | null = null;
    await readSSE(res.body, (evt) => {
      if (evt.type === "message_start" && evt.message?.usage) {
        inputTokens = evt.message.usage.input_tokens ?? null;
        outputTokens = evt.message.usage.output_tokens ?? outputTokens;
      } else if (evt.type === "message_delta") {
        if (evt.usage) outputTokens = evt.usage.output_tokens ?? outputTokens;
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
      } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        onDelta(evt.delta.text ?? "");
      }
    });
    onUsage?.({ inputTokens, outputTokens, stopReason });
    return;
  }

  // OpenAI — usage is only included in the stream when explicitly
  // requested; the final chunk (empty choices array) then carries it.
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: tool.model,
      max_tokens: tool.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: tool.systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let stopReason: string | null = null;
  await readSSE(res.body, (evt) => {
    if (evt.usage) {
      inputTokens = evt.usage.prompt_tokens ?? null;
      outputTokens = evt.usage.completion_tokens ?? null;
    }
    if (evt?.choices?.[0]?.finish_reason) stopReason = evt.choices[0].finish_reason ?? null;
    const delta = evt?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) onDelta(delta);
  });
  onUsage?.({ inputTokens, outputTokens, stopReason });
}

// Non-streaming convenience wrapper (used by the planner, which needs the
// full text before it can parse/validate JSON — no point emitting deltas
// for a response nobody watches token-by-token).
export async function callModelOnce(
  tool: ToolConfig,
  prompt: string,
  signal?: AbortSignal,
  onUsage?: (usage: ModelUsage) => void,
): Promise<string> {
  let full = "";
  await callModel(tool, prompt, (delta) => (full += delta), signal, onUsage);
  return full;
}

// Safe, structured telemetry for a single model call — never the prompt,
// never the output, never a raw error message that might echo either.
// Deliberately narrow: only what's needed to correlate cost/latency/failure
// across the Worker's logs.
export function logModelUsage(entry: {
  provider: string;
  model: string;
  operation: "project_step" | "single_tool" | "planner";
  toolKey?: string;
  usage: ModelUsage;
  durationMs: number;
  status: "success" | "error";
  errorCode?: string;
}): void {
  console.log(
    JSON.stringify({
      scope: "ai_model_call",
      provider: entry.provider,
      model: entry.model,
      operation: entry.operation,
      toolKey: entry.toolKey,
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      stopReason: entry.usage.stopReason,
      durationMs: entry.durationMs,
      status: entry.status,
      errorCode: entry.errorCode,
    }),
  );
}

type SSEEvent = {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: {
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (evt: SSEEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload) as SSEEvent);
      } catch {
        /* ignore malformed */
      }
    }
  }
}
