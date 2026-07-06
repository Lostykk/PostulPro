-- Fase 5: Settings — profile notification prefs, BUSINESS-only API keys,
-- avatar storage.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_push BOOLEAN NOT NULL DEFAULT FALSE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- API keys PostulPro issues to its own (BUSINESS) customers for their
-- integrations — never Anthropic/OpenAI keys. Only key_hash is stored; the
-- plaintext secret is returned once, at creation, by generate_api_key().
CREATE TABLE public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE, DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

CREATE POLICY "Own api keys" ON public.api_keys FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Revoke own api keys" ON public.api_keys FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Delete own api keys" ON public.api_keys FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Row insertion only happens through this SECURITY DEFINER function (no
-- INSERT grant on the table itself), so the BUSINESS-plan check and secret
-- generation can't be bypassed by calling the table API directly.
CREATE OR REPLACE FUNCTION public.generate_api_key(p_name TEXT)
RETURNS TABLE(id UUID, plaintext_key TEXT, key_prefix TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_plan TEXT;
  v_secret TEXT;
  v_prefix TEXT;
  v_hash TEXT;
  v_id UUID;
  v_created TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT plan INTO v_plan FROM public.users WHERE id = v_uid;
  IF v_plan IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'API keys require the BUSINESS plan';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Name is required';
  END IF;

  v_secret := encode(gen_random_bytes(24), 'hex');
  v_prefix := 'pk_' || substr(v_secret, 1, 8);
  v_hash := crypt(v_secret, gen_salt('bf'));

  INSERT INTO public.api_keys (user_id, name, key_prefix, key_hash)
  VALUES (v_uid, trim(p_name), v_prefix, v_hash)
  RETURNING api_keys.id, api_keys.created_at INTO v_id, v_created;

  RETURN QUERY SELECT v_id, ('pp_' || v_secret), v_prefix, v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_api_key(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_api_key(TEXT) TO authenticated;

-- Public avatar storage.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read avatars" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users manage own avatar" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
