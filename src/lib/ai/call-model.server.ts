import type { ToolConfig } from "@/lib/ai/tools-config.server";

// Shared Anthropic/OpenAI streaming caller. Extracted out of
// routes/api/generate-ai.ts so both the single-tool endpoint and the AI
// Project Builder's step executor use the exact same provider-calling
// code — no behavior fork between the two callers.

export async function callModel(
  tool: ToolConfig,
  prompt: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
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
    await readSSE(res.body, (evt) => {
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        onDelta(evt.delta.text ?? "");
      }
    });
    return;
  }

  // OpenAI
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
  await readSSE(res.body, (evt) => {
    const delta = evt?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) onDelta(delta);
  });
}

// Non-streaming convenience wrapper (used by the planner, which needs the
// full text before it can parse/validate JSON — no point emitting deltas
// for a response nobody watches token-by-token).
export async function callModelOnce(
  tool: ToolConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  let full = "";
  await callModel(tool, prompt, (delta) => (full += delta), signal);
  return full;
}

type SSEEvent = {
  type?: string;
  delta?: { type?: string; text?: string };
  choices?: Array<{ delta?: { content?: string } }>;
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
