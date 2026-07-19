import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

// The Nitro Cloudflare adapter attaches `waitUntil` directly onto the
// raw Request object (see node_modules/nitro/dist/presets/cloudflare/
// runtime/_module-handler.mjs's augmentReq), and h3-v2's H3Event stores
// that same request reference with no cloning — so it survives through
// to a TanStack Start route handler's `{ request }`. Defensive access:
// if it's ever unavailable (a different runtime, a future framework
// change), everything below degrades to plain fire-and-forget, which is
// exactly today's behavior — not a regression.
export function getWaitUntil(request: Request): ((p: Promise<unknown>) => void) | null {
  const w = (request as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
  return typeof w === "function" ? w.bind(request) : null;
}

// Marks a reservation 'consumed'. Retries a bounded few times (not
// indefinitely) because the success response carries a factual claim
// about billing state the caller must not make while that state is
// still unconfirmed — see generate-ai.ts / executor.server.ts, both of
// which await this before sending their "done" event. On exhausted
// retries it does NOT guess or force anything: the reservation simply
// stays 'reserved' (the durable, recoverable state) and this logs
// loudly so the ambiguity isn't silently lost. waitUntil plays no role
// here — this call is always awaited inline, before any response goes
// out.
export async function confirmConsumedOrLog(
  supabase: Db,
  reservationId: string,
  generationId: string | null,
  context: Record<string, unknown>,
): Promise<boolean> {
  const retryDelaysMs = [0, 150, 400];
  for (const delayMs of retryDelaysMs) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const { data, error } = await supabase.rpc("resolve_credit_reservation", {
        p_reservation_id: reservationId,
        p_outcome: "consumed",
        p_generation_id: generationId ?? undefined,
      });
      if (error) continue;
      const row = data?.[0];
      // resolved=true: this call won the transition. resolved=false with
      // final_status already "consumed": a previous attempt in this same
      // retry loop actually succeeded but the response was lost — either
      // way the reservation is confirmed consumed, which is all this
      // function promises.
      if (row?.resolved || row?.final_status === "consumed") return true;
    } catch {
      /* transient — fall through to the next retry delay */
    }
  }
  console.error(
    JSON.stringify({
      scope: "credit_reservation_confirm_consumed_failed",
      reservationId,
      generationId,
      ...context,
    }),
  );
  return false;
}

// callModel had no timeout of its own — without one, "timed_out" could
// never be genuine evidence, only a guess. Combines the caller's own
// (client-driven) abort signal with an independent timeout signal, so the
// catch block can tell apart three real causes instead of lumping
// everything into "failed": the client disconnected/aborted, the provider
// call ran too long, or the provider itself returned an error. Checked in
// that priority order in classifyProviderFailure below — a client abort
// is reported as such even if the timeout also happened to fire around
// the same time, since it's the more specific, intentional signal.
export function withProviderTimeout(
  clientSignal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; timeoutSignal: AbortSignal; clear: () => void } {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  return {
    signal: AbortSignal.any([clientSignal, timeoutController.signal]),
    timeoutSignal: timeoutController.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

export function classifyProviderFailure(
  clientSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): "aborted" | "timed_out" | "failed" {
  if (clientSignal.aborted) return "aborted";
  if (timeoutSignal.aborted) return "timed_out";
  return "failed";
}

// Records confirmed-failure evidence (mark_reservation_job_outcome, from
// 20260728000000_reservation_job_evidence.sql) on a reservation before
// attempting the actual refund. Awaited and best-effort: it's a single
// fast UPDATE, worth landing durably before any risk of the isolate dying
// mid-refund — if the refund itself never completes (Worker killed before
// waitUntil finishes, response already closed), this evidence is what
// lets reconcile_stale_reservations_v2 resolve the reservation correctly
// later instead of falling back to the age threshold. Never throws —
// failing to record evidence must not block the refund attempt that
// follows it.
export async function markJobOutcome(
  supabase: Db,
  reservationId: string,
  outcome: "failed" | "aborted" | "timed_out",
  reason: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("mark_reservation_job_outcome", {
      p_reservation_id: reservationId,
      p_outcome: outcome,
      p_reason: reason,
    });
    if (error) {
      console.error(
        JSON.stringify({
          scope: "credit_reservation_mark_job_outcome_failed",
          reservationId,
          outcome,
          error: error.message,
        }),
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "credit_reservation_mark_job_outcome_failed",
        reservationId,
        outcome,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

// Marks a reservation 'refunded'. Unlike confirmConsumedOrLog, this
// never blocks a response — a failure/abort response doesn't claim
// anything about billing state the way a success response does, so
// there's nothing to protect the caller from by waiting synchronously.
// `waitUntil`, when available, only extends how long the Cloudflare
// Workers isolate stays alive for this promise after the Response has
// already been sent — it is NOT the idempotency mechanism (that's
// entirely resolve_credit_reservation's atomic compare-and-swap on the
// persisted ledger row) and NOT a substitute for durability (the ledger
// row already exists, created at reserve time, independent of whether
// this call ever runs at all).
export function refundInBackground(
  supabase: Db,
  reservationId: string,
  reason: string,
  waitUntil: ((p: Promise<unknown>) => void) | null,
): void {
  const task = (async () => {
    try {
      const { error } = await supabase.rpc("resolve_credit_reservation", {
        p_reservation_id: reservationId,
        p_outcome: "refunded",
        p_reason: reason,
      });
      if (error) {
        console.error(
          JSON.stringify({
            scope: "credit_reservation_refund_failed",
            reservationId,
            reason,
            error: error.message,
          }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          scope: "credit_reservation_refund_failed",
          reservationId,
          reason,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  })();

  if (waitUntil) waitUntil(task);
  else void task;
}
