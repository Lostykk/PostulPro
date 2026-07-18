import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getTool } from "@/lib/ai/tools-config.server";
import { callModel, logModelUsage, type ModelUsage } from "@/lib/ai/call-model.server";
import { checkAiExecutionAllowed } from "@/lib/ai/preview-guard.server";
import { maybeSendLowCreditsEmail } from "@/lib/notifications/low-credits.server";
import { isOwner } from "@/lib/auth/is-owner";
import { confirmConsumedOrLog, getWaitUntil, refundInBackground } from "@/lib/ai/credit-reservation.server";

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

        // Fetch user's plan/role once, up front — needed both for the
        // preview allowlist gate (admins bypass it) and the plan gate below.
        const { data: profile, error: profErr } = await supabase
          .from("users")
          .select("plan,role")
          .eq("id", userId)
          .maybeSingle();
        if (profErr || !profile) return json({ error: "Profile not found" }, 404);
        const owner = isOwner(profile);

        // Preview-only allowlist gate — admins bypass the single-QA-user
        // restriction without replacing it; the kill switch still applies to
        // everyone. No-op in production.
        const guard = checkAiExecutionAllowed(userId, owner);
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

        // Plan gate — owners get full internal tool access without a plan change.
        if (tool.planGate && !owner) {
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

        // Reserve credits atomically BEFORE streaming, AND record the
        // reservation itself (reserve_credits_v2, from
        // 20260727000000_credit_reservations_idempotent_refund.sql) — the
        // overspend guard still lives inside the DB function's
        // UPDATE...WHERE clause, so parallel requests can't both pass a
        // stale "remaining credits" check. The old reserve_credits stays
        // untouched and unused from here on.
        const { data: reserveRows, error: reserveErr } = await supabase.rpc("reserve_credits_v2", {
          p_cost: tool.credits,
          p_tool: toolId,
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
        const reservationId = reserve.reservation_id as string;

        await maybeSendLowCreditsEmail(
          supabase,
          userId,
          tool.credits,
          reserve.credits_used,
          reserve.credits_limit,
          new URL(request.url).origin,
        );

        // Build stream. An AbortController threads through to the upstream
        // model fetch so that if the client disconnects mid-generation, the
        // request to Anthropic/OpenAI actually stops (no wasted provider
        // tokens) and — since the abort surfaces as a rejected promise in
        // callModel — falls through to the same catch/refund path below as
        // any other failure. Without this, a closed tab mid-stream would
        // silently keep the reserved credit charged forever.
        const encoder = new TextEncoder();
        const abortController = new AbortController();
        const waitUntil = getWaitUntil(request);
        // Local-only optimization (skip a redundant network call if both
        // the catch block and cancel() fire for the same request) — NOT
        // the idempotency mechanism. That guarantee is entirely
        // resolve_credit_reservation's atomic compare-and-swap on the
        // persisted credit_reservations row, which holds even if this
        // in-memory flag is never set at all (e.g. the isolate is killed
        // before either path runs).
        let settled = false;
        const refundOnce = (reason: string) => {
          if (settled) return;
          settled = true;
          refundInBackground(supabase, reservationId, reason, waitUntil);
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
            let usage: ModelUsage = { inputTokens: null, outputTokens: null, stopReason: null };
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

              // The response about to go out claims the reservation is
              // settled and the credit spent — that claim must be true
              // before it's sent, not eventually true. Block on it here
              // (bounded retries inside confirmConsumedOrLog), rather than
              // firing it in the background the way the refund path does.
              settled = true;
              const confirmed = await confirmConsumedOrLog(supabase, reservationId, gen?.id ?? null, {
                toolId,
                userId,
              });

              if (!confirmed) {
                // Content was generated and persisted, but the ledger
                // can't confirm the reservation as consumed. Sending
                // "done" here would assert a billing fact we don't
                // actually know to be true, so this is reported as an
                // error instead — the reservation itself is left
                // 'reserved' (safe, recoverable, already logged by
                // confirmConsumedOrLog) rather than guessed at.
                send({
                  type: "error",
                  message:
                    "El contenido se generó pero no se pudo confirmar el estado del crédito. Contactá soporte si el problema persiste.",
                });
                try {
                  controller.close();
                } catch {
                  /* already closed */
                }
                return;
              }

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
              // Refund on error — also covers the abort-on-disconnect path
              // via cancel() below. Fire-and-forget: an error response
              // makes no claim about billing state the way "done" does, so
              // there's nothing to protect by blocking on it here.
              refundOnce("provider_error");
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
            refundOnce("client_disconnected");
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
