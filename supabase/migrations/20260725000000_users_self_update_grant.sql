-- Fase C permissions audit found that `authenticated` had NO UPDATE grant
-- at all on public.users (only INSERT/SELECT/DELETE), despite the RLS
-- policy "Users update own profile" (auth.uid() = id) suggesting self-edit
-- was intended. Confirmed by direct testing: a malicious self-escalation
-- attempt (PATCH plan/role) and the legitimate profile-save feature in
-- settings.tsx (name/bio/avatar_url/notify_email/notify_push/primary_goal/
-- company_name/revenue_goal_6m) both failed identically with 42501
-- "permission denied for table users" — this was a real functional bug,
-- not a security control.
--
-- Fix: grant UPDATE scoped to only the columns real users legitimately
-- self-edit via a direct table update. plan/role/credits_used/
-- credits_limit/bonus_credits/affiliate_code/country/onboarding_* stay
-- off this grant — those only ever change through SECURITY DEFINER RPCs
-- (admin_update_user_plan, complete_onboarding), which run with the
-- function owner's privileges and are unaffected by this column grant.
GRANT UPDATE (name, bio, avatar_url, primary_goal, company_name, revenue_goal_6m, notify_email, notify_push)
  ON public.users TO authenticated;

-- Defense in depth: anon had full INSERT/UPDATE/DELETE/SELECT table-level
-- grants on users (a repo-wide pattern across every public table, not
-- specific to this one — see the GO/NO-GO report for the broader note).
-- RLS already blocks all of this today (verified empirically: anon
-- SELECT/UPDATE/DELETE/INSERT against a real row all no-op or error), but
-- revoking the grant removes the fallback-to-full-access if RLS were ever
-- accidentally disabled on this specific table.
REVOKE INSERT, UPDATE, DELETE, SELECT ON public.users FROM anon;
