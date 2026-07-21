import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getTool } from "@/lib/ai/tools-config.server";
import { callModel, logModelUsage, type ModelUsage } from "@/lib/ai/call-model.server";
import { checkAiExecutionAllowed } from "@/lib/ai/preview-guard.server";
import { maybeSendLowCreditsEmail } from "@/lib/notifications/low-credits.server";
import { isOwner } from "@/lib/auth/is-owner";
import { resolveAuthEmail } from "@/lib/api-auth.server";
import {
  classifyProviderFailure,
  confirmConsumedOrLog,
  getWaitUntil,
  markJobOutcome,
  refundInBackground,
  withProviderTimeout,
} from "@/lib/ai/credit-reservation.server";

// Streaming proxy to Anthropic / OpenAI. API keys stay server-side.
// Contract: POST /api/generate-ai with Bearer token + JSON:
//   { tool: ToolId, prompt: string, title?: string }
// Response: text/event-stream with lines:
//   data: {"type":"delta","text":"..."}
//   data: {"type":"done","generationId":"...","creditsRemaining":123}
//   data: {"type":"error","message":"..."}
//
// Financial contract (credit_reservations + generations.credit_reservation_id
// + credit_reservations.job_outcome, from 20260727000000/20260728000000):
//   - "work started" evidence = the reservation row itself (created at
//     reserve time, before any provider call).
//   - "result persisted" and "completed" are the SAME event, by design:
//     a generations row is only ever inserted once real output exists,
//     with credit_reservation_id set in that same INSERT — so a linked
//     generations row is unambiguous completion evidence for the
//     reconciler. Never insert a placeholder/empty row before that point.
//   - "failed" / "aborted" / "timed_out" evidence is recorded via
//     mark_reservation_job_outcome BEFORE attempting the refund, so it
//     survives even if the refund itself never completes (isolate killed
//     mid-flight).
//   - Anything else stays 'reserved' for reconcile_stale_reservations_v2.

const PROVIDER_TIMEOUT_MS = 240_000; // generous relative to every tool's maxTokens — a circuit breaker, not a UX-tuned limit

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
        const guard = checkAiExecutionAllowed(userId, owner, resolveAuthEmail(userData.user));
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
        // untouched and unused from here on. This reservation row, on its
        // own, IS the persistent "work started" evidence — no separate
        // job/status table needed for that.
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
        // any other failure. This is best-effort only, not a financial
        // guarantee: empirically verified against the deployed preview
        // Worker (see docs/premium-redesign-report.md), on this stack
        // (Nitro + h3-v2 + TanStack Start on Cloudflare) neither
        // ReadableStream.cancel() nor request.signal's 'abort' event fired
        // on a real client disconnect in any test run. Resolution
        // therefore never depends on either firing — it depends on
        // runGeneration() actually reaching a terminal outcome.
        const encoder = new TextEncoder();
        const abortController = new AbortController();
        const waitUntil = getWaitUntil(request);
        request.signal?.addEventListener("abort", () => abortController.abort());
        // Independent from abortController: a real circuit breaker on the
        // provider call itself, so "timed_out" can be genuine evidence
        // instead of a guess — callModel previously had no timeout at all.
        const providerTimeout = withProviderTimeout(abortController.signal, PROVIDER_TIMEOUT_MS);
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
            // Registering the WHOLE generation (not just the refund
            // sub-task, as an earlier version of this fix did) with
            // waitUntil is what actually keeps the Workers isolate alive
            // past client disconnect — empirically confirmed: without
            // this, disconnecting during a real deployed test silently
            // killed the isolate before even normal, connected-client-path
            // logs could run. This is bounded by a platform-enforced
            // ceiling (Cloudflare logs "waitUntil() tasks did not complete
            // within the allowed time... and have been cancelled" for
            // slower generations) — it reliably saves short generations,
            // but cannot be the sole guarantee for slow ones. That's what
            // the evidence-based reconciler exists for.
            const work = runGeneration(controller, tool);
            if (waitUntil) waitUntil(work);
            await work;
          },
          cancel(reason) {
            // Best-effort only — see the note above on abortController.
            // Deliberately does NOT resolve the reservation here: a
            // detected disconnect requests cancellation, it does not by
            // itself justify a refund (that would refund "blindly because
            // the tab closed," which is exactly what this design avoids).
            // The actual refund happens through runGeneration()'s own
            // catch block, which only runs once callModel's abort
            // surfaces as a confirmed rejection.
            abortController.abort(reason);
          },
        });

        async function runGeneration(
          controller: ReadableStreamDefaultController<Uint8Array>,
          tool: NonNullable<ReturnType<typeof getTool>>,
        ) {
          const send = (obj: unknown) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch {
              /* controller already closed (client gone) — nothing to send to */
            }
          };
          const closeController = () => {
            try {
              controller.close();
            } catch {
              /* already closed */
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
              providerTimeout.signal,
              (u) => (usage = u),
            );
            providerTimeout.clear();
            logModelUsage({
              provider: tool.provider,
              model: tool.model,
              operation: "single_tool",
              toolKey: toolId,
              usage,
              durationMs: Date.now() - startedAt,
              status: "success",
            });

            // Persist the result. This INSERT is simultaneously "the
            // generation exists," "the result was persisted," and "the
            // generation completed" — credit_reservation_id links it back
            // to the reservation immediately, durably, not just in a JS
            // variable, so a crash one line later still leaves the
            // reconciler with real completion evidence to find.
            const title = (body.title ?? prompt.slice(0, 60)).slice(0, 200);
            const { data: gen, error: genErr } = await supabase
              .from("generations")
              .insert({
                user_id: userId,
                tool: toolId,
                title,
                output: full,
                prompt_json: { prompt } as never,
                tokens_used: usage.outputTokens ?? Math.ceil(full.length / 4),
                credit_reservation_id: reservationId,
              })
              .select("id")
              .maybeSingle();

            if (genErr || !gen?.id) {
              // The model produced real output, but it could not be
              // durably saved — this is a confirmed failure, not an
              // ambiguous case: consuming here would charge the user for
              // a result they can never retrieve. Record evidence before
              // the (fire-and-forget) refund attempt, so the reconciler
              // can recover this even if the refund itself never lands.
              await markJobOutcome(supabase, reservationId, "failed", "generation_persist_failed");
              refundOnce("generation_persist_failed");
              send({
                type: "error",
                message: "No se pudo guardar el resultado. Tus créditos no fueron cobrados.",
              });
              closeController();
              return;
            }

            // The response about to go out claims the reservation is
            // settled and the credit spent — that claim must be true
            // before it's sent, not eventually true. Block on it here
            // (bounded retries inside confirmConsumedOrLog), rather than
            // firing it in the background the way the refund path does.
            settled = true;
            const confirmed = await confirmConsumedOrLog(supabase, reservationId, gen.id, {
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
              // confirmConsumedOrLog, AND now discoverable by the
              // reconciler via the generation_id link set above) rather
              // than guessed at.
              send({
                type: "error",
                message:
                  "El contenido se generó pero no se pudo confirmar el estado del crédito. Contactá soporte si el problema persiste.",
              });
              closeController();
              return;
            }

            const { data: refreshed } = await supabase
              .from("users")
              .select("credits_used,credits_limit")
              .eq("id", userId)
              .maybeSingle();

            send({
              type: "done",
              generationId: gen.id,
              creditsRemaining: refreshed ? refreshed.credits_limit - refreshed.credits_used : null,
            });
            closeController();
          } catch (err) {
            const outcome = classifyProviderFailure(
              abortController.signal,
              providerTimeout.timeoutSignal,
            );
            logModelUsage({
              provider: tool.provider,
              model: tool.model,
              operation: "single_tool",
              toolKey: toolId,
              usage,
              durationMs: Date.now() - startedAt,
              status: "error",
              errorCode: outcome,
            });
            // Record confirmed-failure evidence BEFORE the (fire-and-
            // forget) refund attempt — see the module-level contract
            // comment. Awaited: it's one fast UPDATE, worth landing
            // durably before any risk of the isolate dying mid-refund.
            await markJobOutcome(supabase, reservationId, outcome, outcome);
            refundOnce(outcome);
            send({
              type: "error",
              message: err instanceof Error ? err.message : "Model call failed",
            });
            closeController();
          }
        }

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
