-- Seeds the initial launch campaign, exactly as specified: draft status
-- (never auto-activated by a migration — an admin must explicitly
-- activate it from the panel, see admin_set_promotional_campaign_status),
-- 10 credits/user, 25 max recipients, coupon POSTULPRO30, manual delivery
-- only. hotmart_product_id matches the real, already-configured product
-- (see src/lib/hotmart-config.ts) purely for display/reference in Admin —
-- it does not gate or auto-trigger anything.
--
-- Idempotent: re-running this migration (or applying it to an environment
-- where it already ran) never creates a duplicate campaign or resets an
-- admin's later status change, thanks to the ON CONFLICT DO NOTHING on
-- the UNIQUE internal_name.
INSERT INTO public.promotional_credit_campaigns (
  internal_name,
  public_name,
  description,
  status,
  credits_per_user,
  maximum_recipients,
  coupon_code,
  hotmart_product_id,
  allowed_plan_ids
) VALUES (
  'postulpro_launch_2026',
  'Lanzamiento PostulPro',
  '10 créditos promocionales de bienvenida para las primeras 25 personas que contraten con el cupón POSTULPRO30 (30% de descuento, solo en el primer cobro). Entrega manual desde Admin — sin auto-otorgamiento por webhook.',
  'draft',
  10,
  25,
  'POSTULPRO30',
  '8148076',
  ARRAY['free', 'pro', 'business']
)
ON CONFLICT (internal_name) DO NOTHING;
