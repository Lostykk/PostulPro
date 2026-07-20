-- Reverts a promotional credit grant. Never deletes the original grant
-- row (audit trail preserved), never lets a balance go negative, never
-- double-reverts, and never silently eats into a user's plan/paid
-- credits without an explicit admin acknowledgment.
--
-- Why this can't always cleanly "give back exactly what was given":
-- bonus_credits is a single pooled top-up column (see
-- docs/promotional-credits-launch-campaign-report.md §3) shared by every
-- source that adds to it (this campaign, a future campaign, a real
-- Lemon Squeezy Credits-100 purchase) and consumption draws from the
-- SAME pool as plan credits with no per-source attribution. So "revert
-- this grant's 10 credits" really means "remove up to 10 from
-- bonus_credits, floored at 0" — if bonus_credits is already below the
-- grant amount (because it was spent, or because it never accumulated
-- that high due to other reversals), the shortfall is, by definition,
-- credits that came from elsewhere in the pool. That's exactly the case
-- p_confirm_partial_consumption gates.
CREATE OR REPLACE FUNCTION public.admin_revoke_promotional_credit_grant(
  p_grant_id UUID,
  p_reason TEXT,
  p_confirm_partial_consumption BOOLEAN DEFAULT FALSE
)
RETURNS TABLE(
  ok BOOLEAN,
  message TEXT,
  credits_reverted INT,
  was_partially_consumed BOOLEAN,
  new_bonus_credits INT,
  new_credits_limit INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_grant RECORD;
  v_bonus_before INT;
  v_credits_used INT;
  v_credits_limit_before INT;
  v_revert_amount INT;
  v_shortfall INT;
  v_new_bonus INT;
  v_new_limit INT;
  v_ledger_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF p_grant_id IS NULL THEN
    RAISE EXCEPTION 'grant_id is required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required to revoke a promotional grant';
  END IF;

  SELECT * INTO v_grant FROM public.promotional_credit_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grant not found: %', p_grant_id;
  END IF;

  IF v_grant.status <> 'active' THEN
    -- Idempotent: reverting an already-revoked grant a second time is a
    -- safe no-op, never a double reversal.
    RETURN QUERY SELECT FALSE, ('grant is not active (status: ' || v_grant.status || ') — already reverted or otherwise settled')::TEXT,
      NULL::INT, NULL::BOOLEAN, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  SELECT bonus_credits, credits_used, credits_limit INTO v_bonus_before, v_credits_used, v_credits_limit_before
  FROM public.users WHERE id = v_grant.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grant recipient no longer exists: %', v_grant.user_id;
  END IF;

  v_revert_amount := LEAST(v_grant.credits_granted, v_bonus_before);
  v_shortfall := v_grant.credits_granted - v_revert_amount;

  IF v_shortfall > 0 AND NOT p_confirm_partial_consumption THEN
    -- Refuse without touching anything: only `v_revert_amount` of the
    -- original `credits_granted` can be safely recovered from the bonus
    -- pool alone; the rest would come out of credits the user may have
    -- already used from elsewhere (plan credits or another top-up).
    RETURN QUERY SELECT FALSE,
      (format('%s of %s promotional credits are no longer available in the bonus pool (already consumed or reduced elsewhere) — re-run with p_confirm_partial_consumption = true to revert only the recoverable %s', v_shortfall, v_grant.credits_granted, v_revert_amount))::TEXT,
      NULL::INT, TRUE, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  v_new_bonus := v_bonus_before - v_revert_amount;
  -- credits_limit drops by exactly the amount actually removed from
  -- bonus_credits, and never below credits_used — same non-negative
  -- floor every other credits_limit mutation in this codebase already
  -- enforces (see 20260712000000_refund_events.sql).
  v_new_limit := GREATEST(v_credits_used, v_credits_limit_before - v_revert_amount);

  UPDATE public.users
  SET bonus_credits = v_new_bonus, credits_limit = v_new_limit
  WHERE id = v_grant.user_id;

  INSERT INTO public.billing_history (user_id, event_type, reason)
  VALUES (
    v_grant.user_id,
    'promotional_credit_grant_revoked',
    format('Promotional credit grant reverted: -%s credits (of %s originally granted), reason=%s', v_revert_amount, v_grant.credits_granted, p_reason)
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.promotional_credit_grants
  SET status = 'revoked',
      revoked_at = NOW(),
      revoked_by = auth.uid(),
      revoked_reason = p_reason,
      reversal_ledger_entry_id = v_ledger_id,
      credits_reverted = v_revert_amount
  WHERE id = p_grant_id;

  -- Deliberately does NOT decrement promotional_credit_campaigns.grants_count
  -- — the campaign's recipient cap tracks how many people were ever
  -- granted the bonus (a spend-commitment ceiling), not how many still
  -- hold it. Reverting a grant must never free up a campaign slot for a
  -- second, different grant to the same or another user beyond the
  -- original 25 — that would let a revoke-then-regrant cycle exceed the
  -- intended maximum exposure.

  RETURN QUERY SELECT TRUE, 'reverted'::TEXT, v_revert_amount, (v_shortfall > 0), v_new_bonus, v_new_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_promotional_credit_grant(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_promotional_credit_grant(UUID, TEXT, BOOLEAN) TO authenticated;
