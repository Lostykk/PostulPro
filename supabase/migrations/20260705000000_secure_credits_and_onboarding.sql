-- SECURITY FIX: the original RLS policy on public.users only pinned `role`
-- as immutable on self-updates. plan / credits_used / credits_limit /
-- affiliate_code were left open, so any authenticated user could call the
-- PostgREST API directly (bypassing the app UI entirely) and self-upgrade
-- their plan or grant themselves unlimited credits. Lock those columns down
-- and move all credit/plan mutations server-side into SECURITY DEFINER RPCs.

-- Dedicated idempotency flag for the onboarding welcome bonus. Kept separate
-- from onboarding_completed (which stays freely editable) so the bonus can
-- never be re-claimed by toggling that flag. Added before the policy below
-- so the policy's WITH CHECK can reference it.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_bonus_claimed BOOLEAN NOT NULL DEFAULT FALSE;

DROP POLICY IF EXISTS "Users update own profile" ON public.users;
CREATE POLICY "Users update own profile" ON public.users FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.users WHERE id = auth.uid())
    AND plan = (SELECT plan FROM public.users WHERE id = auth.uid())
    AND credits_used = (SELECT credits_used FROM public.users WHERE id = auth.uid())
    AND credits_limit = (SELECT credits_limit FROM public.users WHERE id = auth.uid())
    AND affiliate_code = (SELECT affiliate_code FROM public.users WHERE id = auth.uid())
    AND onboarding_bonus_claimed = (SELECT onboarding_bonus_claimed FROM public.users WHERE id = auth.uid())
  );

-- Atomically reserve credits for the current user. The overspend guard lives
-- in the UPDATE...WHERE clause itself, so concurrent requests can't both
-- pass a stale "remaining credits" check (no read-then-write race).
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

-- Refund credits previously reserved (e.g. the model call failed before
-- producing output). Floored at 0 so a duplicate/late refund can't push the
-- balance negative.
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

  UPDATE public.users
  SET credits_used = GREATEST(0, public.users.credits_used - p_cost)
  WHERE id = v_uid
  RETURNING public.users.credits_used, public.users.credits_limit INTO v_used, v_limit;

  RETURN QUERY SELECT v_used, v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refund_credits(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_credits(INT) TO authenticated;

-- Completes onboarding and grants the one-time +50 credit welcome bonus
-- atomically. Guarded by onboarding_bonus_claimed so refreshing the page or
-- re-submitting the form cannot grant the bonus more than once.
CREATE OR REPLACE FUNCTION public.complete_onboarding(p_name TEXT, p_country TEXT, p_bio TEXT)
RETURNS TABLE(credits_limit INT, onboarding_completed BOOLEAN, bonus_granted BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limit INT;
  v_completed BOOLEAN;
  v_granted BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE public.users
  SET name = COALESCE(NULLIF(p_name, ''), public.users.name),
      country = p_country,
      bio = p_bio,
      credits_limit = public.users.credits_limit + 50,
      onboarding_completed = TRUE,
      onboarding_bonus_claimed = TRUE
  WHERE id = v_uid AND public.users.onboarding_bonus_claimed = FALSE
  RETURNING public.users.credits_limit, public.users.onboarding_completed INTO v_limit, v_completed;

  IF FOUND THEN
    v_granted := TRUE;
  ELSE
    v_granted := FALSE;
    UPDATE public.users
    SET name = COALESCE(NULLIF(p_name, ''), public.users.name),
        country = p_country,
        bio = p_bio,
        onboarding_completed = TRUE
    WHERE id = v_uid
    RETURNING public.users.credits_limit, public.users.onboarding_completed INTO v_limit, v_completed;
  END IF;

  RETURN QUERY SELECT v_limit, v_completed, v_granted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT) TO authenticated;
