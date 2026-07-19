-- Admin-facing resolution for hotmart_pending_links (Fase G/H/J): a
-- purchase whose buyer_email didn't resolve automatically (buyer
-- resolution failure in the webhook -- see
-- src/lib/hotmart/buyer-linking.server.ts) or, in a future round, a
-- "different email" case an admin confirms manually. Distinct trust
-- model from process_hotmart_event: this is called by an authenticated
-- ADMIN through the app UI (auth.uid() + has_role check), not by the
-- trusted Worker via a shared secret -- same posture as
-- admin_update_user_plan (20260718000000_fix_users_rls_recursion.sql).
--
-- Deliberately minimal: grants the plan/credits for exactly the one
-- pending purchase being resolved (idempotent -- a pending link can only
-- be resolved once, enforced by the status check), records
-- billing_history, and never lets the admin invent a transaction,
-- arbitrary credits, or a plan that doesn't match a real configured
-- offer (p_plan/p_credits_limit/p_billing_interval must still be one of
-- the allowlisted values, checked the same way process_hotmart_event
-- checks them -- the admin resolves *which* real offer the purchase was
-- for, never a made-up one).

CREATE OR REPLACE FUNCTION public.admin_resolve_hotmart_pending_link(
  p_pending_link_id UUID,
  p_target_user_id UUID,
  p_plan TEXT,
  p_billing_interval TEXT,
  p_credits_limit INT
)
RETURNS TABLE(ok BOOLEAN, message TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_link RECORD;
  v_bonus INT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF p_plan NOT IN ('free', 'pro', 'business') THEN
    RAISE EXCEPTION 'Invalid plan: %', p_plan;
  END IF;
  IF p_billing_interval NOT IN ('month', 'year') THEN
    RAISE EXCEPTION 'Invalid billing_interval: %', p_billing_interval;
  END IF;

  SELECT * INTO v_link FROM public.hotmart_pending_links WHERE id = p_pending_link_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending link not found: %', p_pending_link_id;
  END IF;
  IF v_link.status <> 'pending' THEN
    -- Idempotent: resolving an already-resolved (or dismissed) link twice
    -- is a safe no-op, never a second credit grant.
    RETURN QUERY SELECT TRUE, 'already resolved'::TEXT;
    RETURN;
  END IF;

  IF v_link.subscription_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      user_id, provider, provider_subscription_id, product_id, variant_id,
      plan, status, billing_interval, cancelled
    ) VALUES (
      p_target_user_id, 'hotmart', v_link.subscription_id, v_link.product_id, v_link.offer_id,
      p_plan, 'active', p_billing_interval, FALSE
    )
    ON CONFLICT (provider_subscription_id) WHERE provider_subscription_id IS NOT NULL DO UPDATE SET
      user_id = EXCLUDED.user_id,
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      billing_interval = EXCLUDED.billing_interval;
  END IF;

  SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = p_target_user_id;
  UPDATE public.users SET plan = p_plan, credits_limit = p_credits_limit + COALESCE(v_bonus, 0) WHERE id = p_target_user_id;

  UPDATE public.hotmart_pending_links
  SET status = 'resolved', resolved_user_id = p_target_user_id, resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_pending_link_id;

  UPDATE public.hotmart_events SET user_id = p_target_user_id WHERE id = v_link.hotmart_event_id;

  INSERT INTO public.billing_history (user_id, event_type, reason)
  VALUES (p_target_user_id, 'hotmart_admin_resolved_pending_link', 'Admin manually linked a Hotmart purchase (pending_link ' || p_pending_link_id || ') to this account');

  RETURN QUERY SELECT TRUE, 'ok'::TEXT;
END;
$$;

-- Same posture as admin_update_user_plan: only an authenticated admin,
-- never PUBLIC/anon, never a plain authenticated non-admin (enforced
-- inside the function via has_role, not just by the grant).
REVOKE EXECUTE ON FUNCTION public.admin_resolve_hotmart_pending_link(UUID, UUID, TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_hotmart_pending_link(UUID, UUID, TEXT, TEXT, INT) TO authenticated;
