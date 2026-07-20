-- Admin-controlled campaign status transitions. Deliberately narrow: this
-- does NOT create new campaigns (the launch campaign is seeded by a
-- dedicated migration with its exact, reviewed parameters — see
-- 20260801040000) or let an admin change credits_per_user/
-- maximum_recipients/coupon_code from the UI, since those are the
-- numbers this whole launch's cost exposure was reviewed against. Only
-- the operational on/off/close switch is exposed here.
CREATE OR REPLACE FUNCTION public.admin_set_promotional_campaign_status(
  p_campaign_id UUID,
  p_new_status TEXT
)
RETURNS TABLE(ok BOOLEAN, message TEXT, campaign_id UUID, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_id UUID;
  v_status TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;
  IF p_new_status NOT IN ('draft', 'active', 'paused', 'closed') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  -- Fully qualifies `status` on both sides — RETURNS TABLE(..., status
  -- TEXT) implicitly declares a same-named PL/pgSQL variable in scope for
  -- the whole function body, so a bare `status` here is ambiguous
  -- against the table column (the exact bug class documented in
  -- resolve_credit_reservation's own header comment, originally found in
  -- generate_api_key's RETURNS TABLE(id, ...)).
  UPDATE public.promotional_credit_campaigns
  SET status = p_new_status, updated_at = NOW()
  WHERE id = p_campaign_id
  RETURNING public.promotional_credit_campaigns.id, public.promotional_credit_campaigns.status INTO v_id, v_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campaign not found: %', p_campaign_id;
  END IF;

  RETURN QUERY SELECT TRUE, 'updated'::TEXT, v_id, v_status;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_set_promotional_campaign_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_promotional_campaign_status(UUID, TEXT) TO authenticated;
