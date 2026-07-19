-- Commercial reconciliation for Hotmart (Fase I) -- deliberately separate
-- from reconcile_stale_reservations_v2 (the AI-generation credit
-- reservation reconciler). Different domain, different failure modes,
-- different safety envelope: this never touches credit_reservations or
-- generations, and the credit reconciler never touches subscriptions or
-- hotmart_events. Mixing the two into one function/task would make both
-- harder to reason about and harder to safely activate independently.
--
-- Deliberately conservative, per the task's own explicit rule ("no
-- degradar acceso por un estado ambiguo"):
--   1. Subscriptions already marked cancelled (an explicit
--      subscription_cancelled event was received) whose ends_at has
--      passed, but never got a subscription_expired event to actually
--      apply the downgrade -- Hotmart's own expiration notification is
--      not guaranteed to arrive (network issues, webhook briefly down,
--      etc.), so this is the safety net, not the primary mechanism. Only
--      acts on subscriptions with an explicit prior cancellation +
--      elapsed ends_at -- never on an ambiguous/active one.
--   2. hotmart_events stuck in 'pending' past a generous threshold (30
--      min -- a real webhook call completes in milliseconds; anything
--      still 'pending' that long means the Worker crashed or timed out
--      mid-request after the ledger insert but before the RPC call or
--      status update) get flagged 'error' with a clear last_error, so
--      they surface in admin observability (Fase J) instead of silently
--      sitting forever. Never retried automatically, never granted
--      access automatically -- purely a visibility fix.
-- Never touches hotmart_pending_links (those require human judgment, see
-- admin_resolve_hotmart_pending_link) and never processes an unmapped or
-- ambiguous subscription.

CREATE OR REPLACE FUNCTION public.reconcile_hotmart_stale(p_batch_limit INT DEFAULT 200)
RETURNS TABLE(
  expired_subscriptions INT,
  stuck_events_flagged INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_expired INT := 0;
  v_stuck INT := 0;
  v_bonus INT;
  v_row RECORD;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit <= 0 OR p_batch_limit > 500 THEN
    RAISE EXCEPTION 'Invalid batch limit';
  END IF;

  FOR v_row IN
    SELECT id, user_id FROM public.subscriptions
    WHERE provider = 'hotmart'
      AND cancelled = TRUE
      AND status <> 'expired'
      AND status <> 'refunded'
      AND status <> 'chargeback'
      AND ends_at IS NOT NULL
      AND ends_at < NOW()
    LIMIT p_batch_limit
  LOOP
    UPDATE public.subscriptions SET status = 'expired' WHERE id = v_row.id;
    SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = v_row.user_id;
    UPDATE public.users SET plan = 'free', credits_limit = 10 + COALESCE(v_bonus, 0) WHERE id = v_row.user_id;
    INSERT INTO public.billing_history (user_id, event_type, reason)
    VALUES (v_row.user_id, 'hotmart_reconcile_expired', 'Reconciliation: cancelled subscription past its paid period, no expiration event ever received');
    v_expired := v_expired + 1;
  END LOOP;

  UPDATE public.hotmart_events
  SET processing_status = 'error', last_error = 'stuck in pending for over 30 minutes -- reconciled by reconcile_hotmart_stale'
  WHERE processing_status = 'pending' AND received_at < NOW() - INTERVAL '30 minutes';
  GET DIAGNOSTICS v_stuck = ROW_COUNT;

  RETURN QUERY SELECT v_expired, v_stuck;
END;
$$;

-- service_role only -- same posture as reconcile_stale_reservations_v2:
-- never callable by anon/authenticated, no shared-secret gate needed
-- since only the Nitro Task (running with SUPABASE_SERVICE_ROLE_KEY, same
-- as the credit reconciler) ever calls this.
REVOKE EXECUTE ON FUNCTION public.reconcile_hotmart_stale(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_hotmart_stale(INT) TO service_role;
