-- Grants the founder a permanent internal owner/admin entitlement, reusing
-- the existing public.user_roles / has_role('admin') system already used by
-- every RLS policy in this schema (see 20260704231647) instead of a second
-- authorization mechanism. No plan is upgraded, no subscription/order/credit
-- purchase is simulated — this is purely an internal role grant plus a
-- server-side bypass in the two credit-consuming RPCs.

-- 1) Role grant — idempotent, matched by exact auth.users.email (never a
-- partial/LIKE match), errors out loudly instead of silently creating an
-- account if the founder hasn't logged in yet.
DO $$
DECLARE
  v_founder_id UUID;
BEGIN
  SELECT id INTO v_founder_id FROM auth.users WHERE email = 'ignacioo.ch13@gmail.com';

  IF v_founder_id IS NULL THEN
    RAISE EXCEPTION 'Founder account ignacioo.ch13@gmail.com does not exist yet in auth.users — have them log in to preview once, then re-run this migration.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_founder_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.users SET role = 'admin' WHERE id = v_founder_id AND role <> 'admin';
END $$;

-- 2) Credit bypass for admins/owners — server-side only (SECURITY DEFINER,
-- keyed off auth.uid() + has_role, never a client-supplied flag). Skips both
-- the limit check AND the credits_used increment entirely, so it never
-- touches commercial/billing data (no plan change, no fake balance). Usage
-- is still fully observable via the existing generations table insert and
-- logModelUsage telemetry at the call sites — this only removes the
-- consumer-credit accounting for admins, not the audit trail.
CREATE OR REPLACE FUNCTION public.reserve_credits(p_cost INT)
RETURNS TABLE(ok BOOLEAN, credits_used INT, credits_limit INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_used INT;
  v_limit INT;
  v_ok BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid cost';
  END IF;

  IF public.has_role(v_uid, 'admin') THEN
    SELECT public.users.credits_used, public.users.credits_limit INTO v_used, v_limit
    FROM public.users WHERE id = v_uid;
    RETURN QUERY SELECT TRUE, v_used, v_limit;
    RETURN;
  END IF;

  UPDATE public.users
  SET credits_used = public.users.credits_used + p_cost
  WHERE id = v_uid AND public.users.credits_used + p_cost <= public.users.credits_limit
  RETURNING public.users.credits_used, public.users.credits_limit INTO v_used, v_limit;

  IF FOUND THEN
    v_ok := TRUE;
  ELSE
    v_ok := FALSE;
    SELECT public.users.credits_used, public.users.credits_limit INTO v_used, v_limit
    FROM public.users WHERE id = v_uid;
  END IF;

  RETURN QUERY SELECT v_ok, v_used, v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_credits(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_credits(INT) TO authenticated;

-- Matching no-op for refund: an admin's reserve_credits call above never
-- decremented anything, so its refund must never decrement either —
-- otherwise a failed generation would push a real, non-admin balance
-- artifact negative-then-floored for no reason.
CREATE OR REPLACE FUNCTION public.refund_credits(p_cost INT)
RETURNS TABLE(credits_used INT, credits_limit INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_used INT;
  v_limit INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid cost';
  END IF;

  IF public.has_role(v_uid, 'admin') THEN
    SELECT public.users.credits_used, public.users.credits_limit INTO v_used, v_limit
    FROM public.users WHERE id = v_uid;
    RETURN QUERY SELECT v_used, v_limit;
    RETURN;
  END IF;

  UPDATE public.users
  SET credits_used = GREATEST(0, public.users.credits_used - p_cost)
  WHERE id = v_uid
  RETURNING public.users.credits_used, public.users.credits_limit INTO v_used, v_limit;

  RETURN QUERY SELECT v_used, v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_credits(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_credits(INT) TO authenticated;
