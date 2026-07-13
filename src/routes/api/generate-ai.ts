import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getTool } from "@/lib/ai/tools-config.server";
import { callModel, logModelUsage, type ModelUsage } from "@/lib/ai/call-model.server";
import { checkAiExecutionAllowed } from "@/lib/ai/preview-guard.server";

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

        // Preview-only allowlist gate — no-op in production.
        const guard = checkAiExecutionAllowed(userId);
        if (!guard.allowed) return json({ error: guard.message, code: guard.code }, guard.status);

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

        // Fetch user's plan
        const { data: profile, error: profErr } = await supabase
          .from("users")
          .select("plan")
          .eq("id", userId)
          .maybeSingle();
        if (profErr || !profile) return json({ error: "Profile not found" }, 404);

        // Plan gate
        if (tool.planGate) {
          const rank: Record<string, number> = { free: 0, pro: 1, business: 2 };
          if ((rank[profile.plan] ?? 0) < (rank[tool.planGate] ?? 0)) {
            return json(
              {
                error: `Esta herramienta requiere plan ${tool.planGate.toUpperCase()} o superior.`,
                code: "plan_required",
              },
              403,
            );
          }
        }

        // Reserve credits atomically BEFORE streaming. The overspend guard
        // lives inside the DB function's UPDATE...WHERE clause, so parallel
        // requests can't both pass a stale "remaining credits" check.
        const { data: reserveRows, error: reserveErr } = await supabase.rpc("reserve_credits", {
          p_cost: tool.credits,
        });
        if (reserveErr) return json({ error: "Failed to reserve credits" }, 500);
        const reserve = reserveRows?.[0];
        if (!reserve) return json({ error: "Failed to reserve credits" }, 500);
        if (!reserve.ok) {
          const remaining = reserve.credits_limit - reserve.credits_used;
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

        // Build stream. An AbortController threads through to the upstream
        // model fetch so that if the client disconnects mid-generation, the
        // request to Anthropic/OpenAI actually stops (no wasted provider
        // tokens) and — since the abort surfaces as a rejected promise in
        // callModel — falls through to the same catch/refund path below as
        // any other failure. Without this, a closed tab mid-stream would
        // silently keep the reserved credit charged forever.
        const encoder = new TextEncoder();
        const abortController = new AbortController();
        let refunded = false;
        const refundOnce = async () => {
          if (refunded) return;
          refunded = true;
          try {
            await supabase.rpc("refund_credits", { p_cost: tool.credits });
          } catch {
            /* best-effort — nothing else to do if the refund call itself fails */
          }
        };

        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
              } catch {
                /* controller already closed (client gone) — nothing to send to */
              }
            };

            let full = "";
            let usage: ModelUsage = { inputTokens: null, outputTokens: null };
            const startedAt = Date.now();
            try {
              await callModel(
                tool,
                prompt,
                (delta) => {
                  full += delta;
                  send({ type: "delta", text: delta });
                },
                abortController.signal,
                (u) => (usage = u),
              );
              logModelUsage({
                provider: tool.provider,
                model: tool.model,
                operation: "single_tool",
                toolKey: toolId,
                usage,
                durationMs: Date.now() - startedAt,
                status: "success",
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
                  tokens_used: usage.outputTokens ?? Math.ceil(full.length / 4),
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
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            } catch (err) {
              logModelUsage({
                provider: tool.provider,
                model: tool.model,
                operation: "single_tool",
                toolKey: toolId,
                usage,
                durationMs: Date.now() - startedAt,
                status: "error",
                errorCode: "provider_error",
              });
              // Refund on error (atomic decrement, floored at 0) — also
              // covers the abort-on-disconnect path via cancel() below.
              await refundOnce();
              send({
                type: "error",
                message: err instanceof Error ? err.message : "Model call failed",
              });
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
          cancel(reason) {
            // Client disconnected mid-stream: stop the upstream model call
            // and refund. The abort makes callModel's fetch reject, which
            // the start() catch block above also handles — refundOnce()
            // guards against double-refunding if both paths fire.
            abortController.abort(reason);
            void refundOnce();
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
