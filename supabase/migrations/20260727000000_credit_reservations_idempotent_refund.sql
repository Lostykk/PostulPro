-- Persistent, idempotent credit-reservation ledger.
--
-- Problem this fixes: reserve_credits/refund_credits (20260705000000) have
-- no reservation record at all — just a raw UPDATE on users.credits_used.
-- The only "idempotency guard" against a double refund is a JS closure
-- boolean (`refunded`/`settled` in generate-ai.ts / executor.server.ts),
-- scoped to a single request's in-memory lifecycle. It cannot survive a
-- Cloudflare Workers isolate being torn down after the HTTP response
-- closes, and it cannot prevent duplicate refunds across separate
-- requests. Confirmed empirically: two aborted /api/generate-ai calls
-- during QA left credits reserved with zero refund landing.
--
-- This migration does NOT change reserve_credits/refund_credits — they
-- are left in place, untouched, unused after the application code swaps
-- to the functions below (safer than dropping them; trivially revertible
-- by switching the application code back).
--
-- No pricing or consumption-rule change: resolve_credit_reservation's
-- refund path calls the existing refund_credits(p_cost) internally,
-- reusing its exact floor-at-0 decrement — this migration only adds
-- reservation bookkeeping and an atomic compare-and-swap around it.

CREATE TABLE public.credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (length(trim(tool)) > 0),
  cost INT NOT NULL CHECK (cost > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'consumed', 'refunded')),
  generation_id UUID REFERENCES public.generations(id) ON DELETE SET NULL,
  refund_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  -- Defense in depth, independent of the RPCs below: the timestamp
  -- columns and status must always agree, even if some future direct
  -- write (a bug, a manual fix, a service_role script) bypasses the
  -- RPCs entirely.
  CONSTRAINT credit_reservations_reserved_has_no_timestamps
    CHECK (status <> 'reserved' OR (consumed_at IS NULL AND refunded_at IS NULL)),
  CONSTRAINT credit_reservations_consumed_shape
    CHECK (status <> 'consumed' OR (consumed_at IS NOT NULL AND refunded_at IS NULL)),
  CONSTRAINT credit_reservations_refunded_shape
    CHECK (status <> 'refunded' OR (refunded_at IS NOT NULL AND consumed_at IS NULL)),
  CONSTRAINT credit_reservations_reason_only_when_refunded
    CHECK (refund_reason IS NULL OR status = 'refunded')
);
CREATE INDEX credit_reservations_user_id_idx ON public.credit_reservations (user_id);
CREATE INDEX credit_reservations_generation_id_idx ON public.credit_reservations (generation_id) WHERE generation_id IS NOT NULL;
-- Supports reconcile_stale_reservations below (and any future ad hoc
-- reconciliation query): finds abandoned reservations without a full
-- table scan.
CREATE INDEX credit_reservations_stale_lookup_idx ON public.credit_reservations (status, created_at) WHERE status = 'reserved';

ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;

-- The Supabase platform grants anon/authenticated the full table
-- privilege set (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER) on every new table in `public` by default — confirmed
-- repo-wide in 20260714000000_revoke_unused_table_privileges.sql, and
-- specifically worked around for a comparable server-only table in
-- 20260716010000_notification_idempotency.sql ("REVOKE ALL ... FROM
-- anon, authenticated"), which this mirrors. RLS with only a SELECT
-- policy already default-denies INSERT/UPDATE/DELETE with no matching
-- policy, but TRUNCATE/REFERENCES/TRIGGER are NOT filtered by RLS at
-- all — REVOKE ALL first, then grant back only what's actually needed,
-- closes that gap rather than relying on RLS alone.
REVOKE ALL ON public.credit_reservations FROM anon, authenticated;
GRANT ALL ON public.credit_reservations TO service_role;
GRANT SELECT ON public.credit_reservations TO authenticated;

-- Every mutation (insert at reserve time, transition at resolve time)
-- goes through the SECURITY DEFINER RPCs below, which run as the table
-- owner and bypass RLS — so authenticated only ever needs SELECT, never
-- INSERT/UPDATE/DELETE, on this table directly.
CREATE POLICY "Own credit reservations" ON public.credit_reservations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Atomically reserves credits (identical overspend guard to
-- reserve_credits) AND records the reservation itself, returning its id
-- so the caller can later resolve it exactly once. Runs as a single
-- statement inside the caller's transaction: if the INSERT below fails
-- for any reason (e.g. a constraint violation), the uncaught exception
-- aborts the whole function call, so PostgreSQL automatically rolls
-- back the credits_used UPDATE too — there is no window where credits
-- are charged without a matching reservation row, or vice versa.
CREATE OR REPLACE FUNCTION public.reserve_credits_v2(p_cost INT, p_tool TEXT)
RETURNS TABLE(ok BOOLEAN, credits_used INT, credits_limit INT, reservation_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_used INT;
  v_limit INT;
  v_ok BOOLEAN;
  v_reservation_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid cost';
  END IF;
  IF p_tool IS NULL OR length(trim(p_tool)) = 0 THEN
    RAISE EXCEPTION 'Invalid tool';
  END IF;

  UPDATE public.users
  SET credits_used = public.users.credits_used + p_cost
  WHERE public.users.id = v_uid AND public.users.credits_used + p_cost <= public.users.credits_limit
  RETURNING public.users.credits_used, public.users.credits_limit INTO v_used, v_limit;

  IF FOUND THEN
    v_ok := TRUE;
    INSERT INTO public.credit_reservations (user_id, tool, cost, status)
    VALUES (v_uid, p_tool, p_cost, 'reserved')
    RETURNING id INTO v_reservation_id;
  ELSE
    v_ok := FALSE;
    v_reservation_id := NULL;
    SELECT public.users.credits_used, public.users.credits_limit INTO v_used, v_limit
    FROM public.users WHERE public.users.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_ok, v_used, v_limit, v_reservation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_credits_v2(INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_credits_v2(INT, TEXT) TO authenticated;

-- Resolves a reservation exactly once. The `AND status = 'reserved'` in
-- the UPDATE's WHERE clause is the whole idempotency mechanism: UPDATE
-- takes a row-level lock, so of two concurrent callers targeting the
-- same reservation, Postgres serializes them — the first to commit wins
-- the transition, and the second (re-evaluating the WHERE clause against
-- the now-changed row) finds zero matches and no-ops. This holds for any
-- combination: two refunds, two consumes, or one of each racing — there
-- is no interleaving where both a 'consumed' and a 'refunded' outcome
-- can apply to the same reservation.
--
-- Output columns are deliberately named final_status/refunded_cost, NOT
-- status/cost — those are the actual column names on this table, and
-- RETURNS TABLE(...) implicitly declares same-named PL/pgSQL variables
-- in scope for the whole function body. A bare (unqualified) reference
-- to a column that shares a name with one of those OUT parameters is
-- ambiguous and fails at call time — this is the exact bug found and
-- fixed this same day in generate_api_key's RETURNS TABLE(id, ...). This
-- function fully qualifies every table reference AND avoids the
-- collision entirely by not reusing those names for OUT parameters, as
-- defense in depth against the same mistake recurring here.
--
-- p_outcome = 'consumed': the generation succeeded. No credit change
-- (already charged at reserve time) — this call exists purely so a
-- LATE/duplicate refund attempt (e.g. a slow waitUntil racing a fast
-- success) can never apply once the reservation is already consumed.
-- p_outcome = 'refunded': the generation failed/was aborted/timed out.
-- Calls the existing refund_credits(p_cost) — unchanged arithmetic.
--
-- Ownership: WHERE user_id = auth.uid() means a caller can only ever
-- resolve their own reservations, never another user's. If a
-- generation_id is supplied, it's only associated after confirming it
-- belongs to the same caller — otherwise it's silently ignored rather
-- than linking someone else's generation into this reservation's record.
CREATE OR REPLACE FUNCTION public.resolve_credit_reservation(
  p_reservation_id UUID,
  p_outcome TEXT,
  p_generation_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(resolved BOOLEAN, final_status TEXT, refunded_cost INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_cost INT;
  v_current_status TEXT;
  v_gen_id UUID := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_outcome NOT IN ('consumed', 'refunded') THEN
    RAISE EXCEPTION 'Invalid outcome: %', p_outcome;
  END IF;

  IF p_generation_id IS NOT NULL THEN
    SELECT public.generations.id INTO v_gen_id
    FROM public.generations
    WHERE public.generations.id = p_generation_id AND public.generations.user_id = v_uid;
    -- If it didn't belong to this caller, v_gen_id stays NULL — the
    -- UPDATE below's COALESCE then leaves generation_id untouched
    -- instead of linking someone else's generation.
  END IF;

  UPDATE public.credit_reservations
  SET status = p_outcome,
      generation_id = COALESCE(v_gen_id, public.credit_reservations.generation_id),
      refund_reason = CASE WHEN p_outcome = 'refunded' THEN p_reason ELSE NULL END,
      consumed_at = CASE WHEN p_outcome = 'consumed' THEN NOW() ELSE NULL END,
      refunded_at = CASE WHEN p_outcome = 'refunded' THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE public.credit_reservations.id = p_reservation_id
    AND public.credit_reservations.user_id = v_uid
    AND public.credit_reservations.status = 'reserved'
  RETURNING public.credit_reservations.cost INTO v_cost;

  IF NOT FOUND THEN
    -- Already resolved (by an earlier call, a race, or it never
    -- belonged to this user) — report the current state without any
    -- side effect, rather than silently pretending success.
    SELECT public.credit_reservations.status INTO v_current_status
    FROM public.credit_reservations
    WHERE public.credit_reservations.id = p_reservation_id AND public.credit_reservations.user_id = v_uid;
    RETURN QUERY SELECT FALSE, v_current_status, NULL::INT;
    RETURN;
  END IF;

  IF p_outcome = 'refunded' THEN
    PERFORM public.refund_credits(v_cost);
  END IF;

  RETURN QUERY SELECT TRUE, p_outcome, v_cost;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_credit_reservation(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_credit_reservation(UUID, TEXT, UUID, TEXT) TO authenticated;

-- Reconciliation for reservations that never got resolved at all — the
-- safety net for when waitUntil() itself never runs to completion (the
-- Worker isolate is killed before the network call to Postgres even
-- starts), which is the one failure mode nothing above can close, since
-- it happens before any reservation-layer code runs.
--
-- Intentionally NOT exposed to authenticated/anon: deciding "this
-- reservation is abandoned, refund it" is an operational judgement
-- call (a scheduled job or an admin action), not something a user
-- should be able to trigger for their own reservations on demand — a
-- user-triggered version could be used to force-refund a generation
-- that is just slow but still legitimately in progress. Idempotent by
-- construction: it just calls resolve_credit_reservation per stale row,
-- which is itself a safe no-op if something else already resolved that
-- row first.
--
-- Threshold default of 30 minutes: PostulPro's AI generations normally
-- complete in seconds to low minutes (see tools-config.server.ts costs);
-- 30 minutes is chosen to make a false-positive reconciliation (refunding
-- a request that was merely slow, not actually abandoned) exceedingly
-- unlikely rather than to be a tight cleanup window.
CREATE OR REPLACE FUNCTION public.reconcile_stale_reservations(p_older_than_minutes INT DEFAULT 30)
RETURNS TABLE(reservation_id UUID, outcome TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_older_than_minutes IS NULL OR p_older_than_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid threshold';
  END IF;

  FOR v_row IN
    SELECT public.credit_reservations.id, public.credit_reservations.user_id
    FROM public.credit_reservations
    WHERE public.credit_reservations.status = 'reserved'
      AND public.credit_reservations.created_at < NOW() - (p_older_than_minutes || ' minutes')::INTERVAL
  LOOP
    -- refund_credits acts on auth.uid() (the caller), not an arbitrary
    -- target — resolve_credit_reservation is SECURITY DEFINER but its
    -- own ownership check (user_id = auth.uid()) would reject a
    -- service_role caller acting on someone else's behalf. This
    -- reconciliation path is the one legitimate exception to "only the
    -- owner resolves their own reservation", so it updates the ledger
    -- and refunds directly rather than calling resolve_credit_reservation.
    UPDATE public.credit_reservations
    SET status = 'refunded',
        refund_reason = 'stale_reconciliation',
        refunded_at = NOW(),
        updated_at = NOW()
    WHERE public.credit_reservations.id = v_row.id
      AND public.credit_reservations.status = 'reserved';

    IF FOUND THEN
      UPDATE public.users
      SET credits_used = GREATEST(0, public.users.credits_used - (
        SELECT public.credit_reservations.cost FROM public.credit_reservations WHERE public.credit_reservations.id = v_row.id
      ))
      WHERE public.users.id = v_row.user_id;
      RETURN QUERY SELECT v_row.id, 'refunded'::TEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_stale_reservations(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stale_reservations(INT) TO service_role;
