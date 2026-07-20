-- Atomic promotional-credit grant. Same trust model as
-- admin_update_user_plan / admin_resolve_hotmart_pending_link: called by
-- an authenticated ADMIN through the app UI (auth.uid() + has_role), not
-- by a trusted server via a shared secret — there is no service-role
-- exposure to the frontend here.
--
-- Everything below runs inside ONE transaction (the function body): if
-- any step raises, Postgres rolls back the whole thing — no orphaned
-- grant row, no balance change without a matching grant, no campaign
-- counter drift. See docs/promotional-credits-launch-campaign-report.md
-- §3 for why this increments bonus_credits (the existing top-up
-- mechanism) instead of a new, disconnected balance column.

CREATE OR REPLACE FUNCTION public.admin_grant_promotional_credits(
  p_campaign_id UUID,
  p_target_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_hotmart_reference TEXT DEFAULT NULL
)
RETURNS TABLE(
  ok BOOLEAN,
  message TEXT,
  grant_id UUID,
  credits_granted INT,
  new_bonus_credits INT,
  new_credits_limit INT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_campaign RECORD;
  v_target_exists BOOLEAN;
  v_idempotency_key TEXT;
  v_grant_id UUID;
  v_bonus INT;
  v_limit INT;
  v_existing RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF p_campaign_id IS NULL THEN
    RAISE EXCEPTION 'campaign_id is required';
  END IF;
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;

  -- Row lock on the campaign for the whole transaction: two concurrent
  -- grant attempts against the SAME campaign (even for different users)
  -- serialize here, so the grants_count <= maximum_recipients check
  -- below can never race past the limit. This is the same pattern
  -- admin_resolve_hotmart_pending_link uses (FOR UPDATE on the row being
  -- resolved) applied to the shared counter instead of a per-row status.
  SELECT * INTO v_campaign FROM public.promotional_credit_campaigns
  WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_id;
  END IF;

  IF v_campaign.status <> 'active' THEN
    RETURN QUERY SELECT FALSE, ('campaign is not active (status: ' || v_campaign.status || ')')::TEXT, NULL::UUID, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;
  IF v_campaign.starts_at IS NOT NULL AND NOW() < v_campaign.starts_at THEN
    RETURN QUERY SELECT FALSE, 'campaign has not started yet'::TEXT, NULL::UUID, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;
  IF v_campaign.ends_at IS NOT NULL AND NOW() > v_campaign.ends_at THEN
    RETURN QUERY SELECT FALSE, 'campaign has already ended'::TEXT, NULL::UUID, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;
  IF v_campaign.grants_count >= v_campaign.maximum_recipients THEN
    RETURN QUERY SELECT FALSE, 'campaign has reached its maximum recipients'::TEXT, NULL::UUID, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.users WHERE id = p_target_user_id) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'Target user not found: %', p_target_user_id;
  END IF;
  IF v_campaign.allowed_plan_ids IS NOT NULL AND array_length(v_campaign.allowed_plan_ids, 1) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE id = p_target_user_id AND plan = ANY(v_campaign.allowed_plan_ids)
    ) THEN
      RETURN QUERY SELECT FALSE, 'target user plan is not eligible for this campaign'::TEXT, NULL::UUID, NULL::INT, NULL::INT, NULL::INT;
      RETURN;
    END IF;
  END IF;

  -- Deterministic idempotency key — see the grants table's own comment
  -- for why this is computed here, not caller-supplied. Kept short (16
  -- hex chars of the digest) purely for a friendlier admin-facing
  -- display; the real uniqueness guarantee is the UNIQUE(campaign_id,
  -- user_id) constraint, not the string length here.
  v_idempotency_key := 'promo:' || left(encode(extensions.digest(p_campaign_id::TEXT || ':' || p_target_user_id::TEXT, 'sha256'), 'hex'), 32);

  -- Idempotent no-op: a prior grant for this exact (campaign, user) pair
  -- already exists. Never a second grant, regardless of whether this is
  -- a genuine double-click, a retried request, or an admin mistakenly
  -- repeating the action for the same user.
  SELECT * INTO v_existing FROM public.promotional_credit_grants
  WHERE campaign_id = p_campaign_id AND user_id = p_target_user_id;
  IF FOUND THEN
    RETURN QUERY SELECT TRUE, ('already granted (status: ' || v_existing.status || ')')::TEXT, v_existing.id, v_existing.credits_granted, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  INSERT INTO public.promotional_credit_grants (
    campaign_id, user_id, credits_granted, reason, idempotency_key, granted_by, hotmart_reference
  ) VALUES (
    p_campaign_id, p_target_user_id, v_campaign.credits_per_user, p_reason, v_idempotency_key, auth.uid(), p_hotmart_reference
  )
  RETURNING id INTO v_grant_id;

  -- Same non-negative-floor / bonus_credits pattern every other
  -- credits_limit-affecting RPC in this codebase already uses (Hotmart,
  -- Lemon Squeezy, admin_resolve_hotmart_pending_link) — never a direct
  -- balance invention, always plan_base-implicit via the existing
  -- bonus_credits addition.
  UPDATE public.users
  SET bonus_credits = bonus_credits + v_campaign.credits_per_user,
      credits_limit = credits_limit + v_campaign.credits_per_user
  WHERE id = p_target_user_id
  RETURNING bonus_credits, credits_limit INTO v_bonus, v_limit;

  UPDATE public.promotional_credit_campaigns
  SET grants_count = grants_count + 1, updated_at = NOW()
  WHERE id = p_campaign_id;

  INSERT INTO public.billing_history (user_id, event_type, reason)
  VALUES (
    p_target_user_id,
    'promotional_credit_grant',
    'Promotional credits granted: campaign=' || v_campaign.internal_name || ', amount=' || v_campaign.credits_per_user || COALESCE(', reason=' || p_reason, '')
  );

  RETURN QUERY SELECT TRUE, 'granted'::TEXT, v_grant_id, v_campaign.credits_per_user, v_bonus, v_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_grant_promotional_credits(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_grant_promotional_credits(UUID, UUID, TEXT, TEXT) TO authenticated;
