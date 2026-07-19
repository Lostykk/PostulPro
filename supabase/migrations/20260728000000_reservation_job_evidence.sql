-- Evidence-based reconciliation for credit_reservations
-- (20260727000000_credit_reservations_idempotent_refund.sql). That
-- migration made the ledger idempotent and durable, but its
-- reconcile_stale_reservations refunds any 'reserved' row past an age
-- threshold with NO evidence of what actually happened to the underlying
-- generation — a genuinely slow-but-successful generation could get
-- refunded while still delivering free output. This migration adds the
-- minimum persistent evidence needed to reconcile safely:
--
--   1. generations.credit_reservation_id — set by application code at
--      INSERT time (not just when the reservation is later resolved), so
--      "did this reservation's work actually complete?" is answerable by
--      a direct row lookup instead of inferred from timing.
--   2. credit_reservations.job_outcome(_reason/_at) — set by application
--      code only when it has confirmed (not guessed) that the underlying
--      attempt failed, was aborted, or timed out. Absence of a value does
--      NOT mean failure; it means "no confirmed evidence either way".
--
-- reconcile_stale_reservations_v2 uses both, plus per-tool age thresholds
-- as a last-resort fallback ONLY when neither positive nor negative
-- evidence exists. The old reconcile_stale_reservations is left
-- untouched and still callable (service_role only, never invoked by
-- application code) — it is superseded, not removed, so the rollback
-- for this migration doesn't have to reconstruct it.

-- 1. Completion evidence: a direct, unambiguous link from the actual
-- output row back to the reservation that paid for it. Nullable and
-- ON DELETE SET NULL — losing this link only means the row falls back to
-- "no completion evidence found", never a false positive.
ALTER TABLE public.generations
  ADD COLUMN credit_reservation_id UUID REFERENCES public.credit_reservations(id) ON DELETE SET NULL;

CREATE INDEX idx_generations_credit_reservation_id
  ON public.generations (credit_reservation_id)
  WHERE credit_reservation_id IS NOT NULL;

-- 2. Failure evidence: set once, only by the owning request's own
-- confirmed-failure code path (never by client-controlled input beyond
-- which of 3 fixed enum values). CHECK mirrors credit_reservations'
-- existing status-shape constraints: only meaningful while still
-- 'reserved', and only ever set once (enforced by the RPC's WHERE
-- clause below, not by a CHECK, since CHECK can't reference status here
-- without a trigger).
ALTER TABLE public.credit_reservations
  ADD COLUMN job_outcome TEXT CHECK (job_outcome IN ('failed', 'aborted', 'timed_out')),
  ADD COLUMN job_outcome_reason TEXT,
  ADD COLUMN job_outcome_at TIMESTAMPTZ;

-- Records confirmed-failure evidence on a reservation the caller owns.
-- Idempotent by design (WHERE job_outcome IS NULL): the first confirmed
-- failure wins and is never silently overwritten by a second, possibly
-- contradictory one. This does NOT resolve the reservation — it only
-- leaves evidence for reconcile_stale_reservations_v2 (or the normal
-- resolve_credit_reservation call that should follow in the same
-- request) to act on. A malicious caller forging 'failed' evidence early
-- gains nothing: the reconciler still enforces its own age threshold
-- regardless of job_outcome, so this can't be used to jump the queue for
-- an early refund on a reservation that's actually still in flight.
CREATE OR REPLACE FUNCTION public.mark_reservation_job_outcome(
  p_reservation_id UUID,
  p_outcome TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_outcome NOT IN ('failed', 'aborted', 'timed_out') THEN
    RAISE EXCEPTION 'Invalid outcome: %', p_outcome;
  END IF;

  UPDATE public.credit_reservations
  SET job_outcome = p_outcome,
      job_outcome_reason = p_reason,
      job_outcome_at = NOW(),
      updated_at = NOW()
  WHERE public.credit_reservations.id = p_reservation_id
    AND public.credit_reservations.user_id = v_uid
    AND public.credit_reservations.status = 'reserved'
    AND public.credit_reservations.job_outcome IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_reservation_job_outcome(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_reservation_job_outcome(UUID, TEXT, TEXT) TO authenticated;

-- Evidence-based reconciliation, replacing the blind-by-age
-- reconcile_stale_reservations for actual use. For each 'reserved' row,
-- in order:
--   a) a generations row references it (credit_reservation_id) => the
--      work actually completed and produced real output => consumed,
--      with that generation linked.
--   b) job_outcome is set (confirmed failed/aborted/timed_out by the
--      request that owned it) => refunded, reason = job_outcome value.
--   c) neither (a) nor (b), AND the reservation is older than a safe
--      per-tool threshold (generous multiples of each tool's expected
--      duration, derived from tools-config.server.ts's maxTokens — see
--      inline comment) => refunded, reason = 'no_evidence_after_threshold'.
--      This is the only branch that risks a false positive (a
--      legitimately still-running generation), which is exactly why the
--      thresholds are generous rather than the old flat 30 minutes.
--   d) none of the above => left untouched. This is the common case for
--      any reservation still genuinely in flight.
-- Batched and limited so a single call can't scan or lock an unbounded
-- number of rows. Mirrors resolve_credit_reservation's arithmetic
-- exactly (same GREATEST(0, ...) floor) but can't call it directly
-- because that function scopes to auth.uid() — this reconciler
-- necessarily acts across users, same constraint the superseded
-- reconcile_stale_reservations already documented.
CREATE OR REPLACE FUNCTION public.reconcile_stale_reservations_v2(p_batch_limit INT DEFAULT 200)
RETURNS TABLE(reservation_id UUID, outcome TEXT, evidence TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_gen_id UUID;
  v_threshold INTERVAL;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit <= 0 OR p_batch_limit > 1000 THEN
    RAISE EXCEPTION 'Invalid batch limit';
  END IF;

  FOR v_row IN
    SELECT public.credit_reservations.id,
           public.credit_reservations.user_id,
           public.credit_reservations.tool,
           public.credit_reservations.cost,
           public.credit_reservations.created_at,
           public.credit_reservations.job_outcome
    FROM public.credit_reservations
    WHERE public.credit_reservations.status = 'reserved'
    ORDER BY public.credit_reservations.created_at ASC
    LIMIT p_batch_limit
  LOOP
    -- (a) Completion evidence.
    SELECT public.generations.id INTO v_gen_id
    FROM public.generations
    WHERE public.generations.credit_reservation_id = v_row.id
    LIMIT 1;

    IF v_gen_id IS NOT NULL THEN
      UPDATE public.credit_reservations
      SET status = 'consumed',
          generation_id = v_gen_id,
          consumed_at = NOW(),
          updated_at = NOW()
      WHERE public.credit_reservations.id = v_row.id
        AND public.credit_reservations.status = 'reserved';
      IF FOUND THEN
        RETURN QUERY SELECT v_row.id, 'consumed'::TEXT, 'linked_generation'::TEXT;
      END IF;
      CONTINUE;
    END IF;

    -- (b) Confirmed-failure evidence.
    IF v_row.job_outcome IS NOT NULL THEN
      UPDATE public.credit_reservations
      SET status = 'refunded',
          refund_reason = v_row.job_outcome,
          refunded_at = NOW(),
          updated_at = NOW()
      WHERE public.credit_reservations.id = v_row.id
        AND public.credit_reservations.status = 'reserved';
      IF FOUND THEN
        UPDATE public.users
        SET credits_used = GREATEST(0, public.users.credits_used - v_row.cost)
        WHERE public.users.id = v_row.user_id;
        RETURN QUERY SELECT v_row.id, 'refunded'::TEXT, v_row.job_outcome;
      END IF;
      CONTINUE;
    END IF;

    -- (c) No evidence either way — only act past a generous, per-tool
    -- safe threshold. Values are wide multiples of each tool's expected
    -- duration (tools-config.server.ts maxTokens: 1200-8000 across
    -- copywriter/social-pack/business-plan/consultant/sales-email/
    -- landing-copy/email-sequences), not tuned to typical latency — the
    -- goal is "impossible to still be legitimately running", not
    -- "slightly past average".
    v_threshold := CASE v_row.tool
      WHEN 'copywriter'  THEN INTERVAL '10 minutes'
      WHEN 'landing-copy' THEN INTERVAL '10 minutes'
      WHEN 'sales-email' THEN INTERVAL '15 minutes'
      WHEN 'consultant'  THEN INTERVAL '15 minutes'
      WHEN 'social-pack' THEN INTERVAL '20 minutes'
      WHEN 'email-sequences' THEN INTERVAL '20 minutes'
      WHEN 'business-plan' THEN INTERVAL '30 minutes'
      ELSE INTERVAL '30 minutes' -- unknown/future tool: most conservative threshold
    END;

    IF v_row.created_at < NOW() - v_threshold THEN
      UPDATE public.credit_reservations
      SET status = 'refunded',
          refund_reason = 'no_evidence_after_threshold',
          refunded_at = NOW(),
          updated_at = NOW()
      WHERE public.credit_reservations.id = v_row.id
        AND public.credit_reservations.status = 'reserved';
      IF FOUND THEN
        UPDATE public.users
        SET credits_used = GREATEST(0, public.users.credits_used - v_row.cost)
        WHERE public.users.id = v_row.user_id;
        RETURN QUERY SELECT v_row.id, 'refunded'::TEXT, 'no_evidence_after_threshold'::TEXT;
      END IF;
    END IF;
    -- (d) else: still within threshold, no evidence — leave untouched,
    -- no row returned for it.
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_stale_reservations_v2(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_reservations_v2(INT) TO service_role;
