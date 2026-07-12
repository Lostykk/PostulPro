-- Persist the onboarding fields that were being collected in the UI but
-- silently discarded (goal / target / company — see onboarding.tsx's old
-- comment "used to personalize copy only; not persisted yet"). These are
-- optional personalization context for the AI Project Builder's planner —
-- never a promise of results, never sent to the AI provider verbatim
-- without the user's own idea.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS primary_goal TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS revenue_goal_6m INT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS company_name TEXT;

-- Extend complete_onboarding to accept + persist the three new optional
-- fields alongside the existing name/country/bio, preserving the exact
-- same bonus-credit-once guard behavior.
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_name TEXT,
  p_country TEXT,
  p_bio TEXT,
  p_primary_goal TEXT DEFAULT NULL,
  p_revenue_goal_6m INT DEFAULT NULL,
  p_company_name TEXT DEFAULT NULL
)
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
      primary_goal = p_primary_goal,
      revenue_goal_6m = p_revenue_goal_6m,
      company_name = NULLIF(p_company_name, ''),
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
        primary_goal = p_primary_goal,
        revenue_goal_6m = p_revenue_goal_6m,
        company_name = NULLIF(p_company_name, ''),
        onboarding_completed = TRUE
    WHERE id = v_uid
    RETURNING public.users.credits_limit, public.users.onboarding_completed INTO v_limit, v_completed;
  END IF;

  RETURN QUERY SELECT v_limit, v_completed, v_granted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT, TEXT, INT, TEXT) TO authenticated;

-- The old 3-arg overload becomes redundant. Drop it so PostgREST doesn't
-- have two "complete_onboarding" candidates with an ambiguous default-arg
-- overlap for RPC name resolution.
DROP FUNCTION IF EXISTS public.complete_onboarding(TEXT, TEXT, TEXT);
