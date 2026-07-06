-- Fase 4: affiliate click tracking + referral attribution on signup.

CREATE TABLE public.affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT INSERT ON public.affiliate_clicks TO anon, authenticated;
GRANT SELECT ON public.affiliate_clicks TO authenticated;
GRANT ALL ON public.affiliate_clicks TO service_role;
ALTER TABLE public.affiliate_clicks ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors) can log a click — this is just a
-- counter, no PII, and it's write-only for anon (no SELECT grant to anon).
CREATE POLICY "Anyone logs a click" ON public.affiliate_clicks FOR INSERT
  WITH CHECK (TRUE);

-- Only the code's owner (or admin) can read their own click count.
CREATE POLICY "Owner reads own clicks" ON public.affiliate_clicks FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.affiliate_code = affiliate_clicks.affiliate_code)
  );

-- Extend the new-user trigger to attribute a referral when the signup
-- carries a `ref` affiliate code in its metadata (set by the client from
-- the ?ref= query param captured on the landing page). commission_rate is
-- locked in at this moment based on the REFERRER's plan at signup time, per
-- the commercial rule: PRO = 30%, BUSINESS = 40%, free = 0% (affiliates is
-- a PRO+ feature; a still-free referrer's link earns no commission).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
  v_referrer_plan TEXT;
  v_rate NUMERIC;
BEGIN
  INSERT INTO public.users (id, email, name, avatar_url, affiliate_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name'),
    NEW.raw_user_meta_data->>'avatar_url',
    public.generate_affiliate_code()
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');

  IF NEW.raw_user_meta_data->>'ref' IS NOT NULL THEN
    SELECT id, plan INTO v_referrer_id, v_referrer_plan
    FROM public.users WHERE affiliate_code = NEW.raw_user_meta_data->>'ref';

    IF v_referrer_id IS NOT NULL AND v_referrer_id <> NEW.id THEN
      v_rate := CASE v_referrer_plan WHEN 'business' THEN 40 WHEN 'pro' THEN 30 ELSE 0 END;
      INSERT INTO public.affiliate_referrals (referrer_id, referred_user_id, commission_rate, commission_amount, status)
      VALUES (v_referrer_id, NEW.id, v_rate, 0, 'pending');
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- Let a referrer read the basic profile (name/email/plan) of the users they
-- referred, for the affiliate history table. Without this, embedding
-- users via the affiliate_referrals -> users FK in a client select would
-- silently return null (RLS only otherwise allows reading your own row).
CREATE POLICY "Referrer reads referred profile" ON public.users FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.affiliate_referrals ar
      WHERE ar.referred_user_id = users.id AND ar.referrer_id = auth.uid()
    )
  );
