-- ROOT CAUSE: "Users update own profile" (20260705000000) pins role/plan/
-- credits_used/credits_limit/affiliate_code/onboarding_bonus_claimed via
-- subqueries like `role = (SELECT role FROM public.users WHERE id = auth.uid())`
-- INSIDE a policy defined ON public.users itself. Postgres has to re-apply
-- users' RLS to resolve that inner SELECT, which re-enters this same policy
-- — literal infinite recursion ("infinite recursion detected in policy for
-- relation users"), triggered by ANY UPDATE on the table (including an
-- admin's, via /admin's plan changer), because Postgres must evaluate every
-- permissive policy that applies to the command, not just the one that
-- would ultimately grant access.
--
-- FIX: never subquery public.users from within its own policy. Column-level
-- GRANTs are a separate, non-recursive Postgres mechanism — restrict which
-- columns `authenticated` may even name in an UPDATE's SET list, independent
-- of RLS. role/plan/credits_used/credits_limit/affiliate_code/
-- onboarding_bonus_claimed are removed from that grant entirely; every
-- legitimate mutation of those columns already goes through a SECURITY
-- DEFINER RPC (reserve_credits, refund_credits, complete_onboarding, and the
-- new admin_update_user_plan below), which run as the function owner and
-- bypass column grants — so this doesn't break any of them. has_role() was
-- already exactly this pattern (SECURITY DEFINER over user_roles, never
-- querying users) — this migration just stops reintroducing the same bug
-- against public.users itself.

DROP POLICY IF EXISTS "Users update own profile" ON public.users;

REVOKE UPDATE ON public.users FROM authenticated;
GRANT UPDATE (
  name, avatar_url, bio,
  notify_email, notify_push,
  primary_goal, revenue_goal_6m, company_name
) ON public.users TO authenticated;

CREATE POLICY "Users update own profile" ON public.users FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admin-only, audited plan changes — replaces admin.tsx's raw
-- `.from("users").update({ plan })`, which (a) depended on the now-revoked
-- column grant and would simply fail from here on, and (b) had no server-
-- side admin check beyond RLS. Never touches role/credits/affiliate_code,
-- never creates an order/subscription/webhook event — this is a QA/admin
-- override of the plan column only, not a simulated purchase.
CREATE OR REPLACE FUNCTION public.admin_update_user_plan(p_target_user_id UUID, p_new_plan TEXT)
RETURNS TABLE(user_id UUID, plan TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_plan TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;
  IF p_new_plan NOT IN ('free', 'pro', 'business') THEN
    RAISE EXCEPTION 'Invalid plan: %', p_new_plan;
  END IF;

  UPDATE public.users
  SET plan = p_new_plan
  WHERE public.users.id = p_target_user_id
  RETURNING public.users.id, public.users.plan INTO v_id, v_plan;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_target_user_id;
  END IF;

  RETURN QUERY SELECT v_id, v_plan;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_user_plan(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_plan(UUID, TEXT) TO authenticated;
