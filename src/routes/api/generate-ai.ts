import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getTool, type ToolConfig } from "@/lib/ai/tools-config.server";

// Streaming proxy to Anthropic / OpenAI. API keys stay server-side.
// Contract: POST /api/generate-ai with Bearer token + JSON:
//   { tool: ToolId, prompt: string, title?: string }
// Response: text/event-stream with lines:
//   data: {"type":"delta","text":"..."}
//   data: {"type":"done","generationId":"...","creditsRemaining":123}
//   data: {"type":"error","message":"..."}

export const Route = createFileRoute("/api/generate-ai")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) {
          return json({ error: "Unauthorized" }, 401);
        }
        const token = auth.slice(7);

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_KEY) {
          return json({ error: "Supabase not configured" }, 500);
        }

        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
          global: {
            headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
          },
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });

        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
        const userId = userData.user.id;

        let body: { tool?: string; prompt?: string; title?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid JSON body" }, 400);
        }

        const toolId = body.tool ?? "";
        const prompt = body.prompt?.trim() ?? "";
        if (!prompt) return json({ error: "prompt is required" }, 400);

        const tool = getTool(toolId);
        if (!tool) return json({ error: `Unknown tool: ${toolId}` }, 400);

        // Fetch user's plan + credits
        const { data: profile, error: profErr } = await supabase
          .from("users")
          .select("plan,credits_used,credits_limit")
          .eq("id", userId)
          .maybeSingle();
        if (profErr || !profile) return json({ error: "Profile not found" }, 404);

        // Plan gate
        if (tool.planGate) {
          const rank: Record<string, number> = { free: 0, pro: 1, business: 2 };
          if ((rank[profile.plan] ?? 0) < (rank[tool.planGate] ?? 0)) {
            return json(
              { error: `Esta herramienta requiere plan ${tool.planGate.toUpperCase()} o superior.`, code: "plan_required" },
              403,
            );
          }
        }

        // Credits
        const remaining = profile.credits_limit - profile.credits_used;
        if (remaining < tool.credits) {
          return json(
            {
              error: `Créditos insuficientes. Necesitas ${tool.credits}, tienes ${remaining}.`,
              code: "insufficient_credits",
              needed: tool.credits,
              remaining,
            },
            402,
          );
        }

        // Reserve credits BEFORE streaming so parallel requests can't overspend.
        const { error: reserveErr } = await supabase
          .from("users")
          .update({ credits_used: profile.credits_used + tool.credits })
          .eq("id", userId);
        if (reserveErr) return json({ error: "Failed to reserve credits" }, 500);

        // Build stream
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };

            let full = "";
            try {
              await callModel(tool, prompt, (delta) => {
                full += delta;
                send({ type: "delta", text: delta });
              });

              // Persist generation
              const title = (body.title ?? prompt.slice(0, 60)).slice(0, 200);
              const { data: gen } = await supabase
                .from("generations")
                .insert({
                  user_id: userId,
                  tool: toolId,
                  title,
                  output: full,
                  prompt_json: { prompt } as never,
                  tokens_used: Math.ceil(full.length / 4),
                })
                .select("id")
                .maybeSingle();

              const { data: refreshed } = await supabase
                .from("users")
                .select("credits_used,credits_limit")
                .eq("id", userId)
                .maybeSingle();

              send({
                type: "done",
                generationId: gen?.id ?? null,
                creditsRemaining: refreshed
                  ? refreshed.credits_limit - refreshed.credits_used
                  : null,
              });
              controller.close();
            } catch (err) {
              // Refund on error
              await supabase
                .from("users")
                .update({ credits_used: profile.credits_used })
                .eq("id", userId);
              send({
                type: "error",
                message: err instanceof Error ? err.message : "Model call failed",
              });
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function callModel(
  tool: ToolConfig,
  prompt: string,
  onDelta: (text: string) => void,
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
