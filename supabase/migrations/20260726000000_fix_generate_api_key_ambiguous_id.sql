-- generate_api_key(TEXT) has RETURNS TABLE(id UUID, ...), which implicitly
-- declares a PL/pgSQL variable named `id` in scope for the whole function
-- body. The plan-gate query ("SELECT plan INTO v_plan FROM public.users
-- WHERE id = v_uid") used the bare, unqualified `id` — ambiguous against
-- that implicit OUT variable, so PostgreSQL rejected every single call
-- with "column reference \"id\" is ambiguous" (42702) before the intended
-- BUSINESS-plan check ever ran. Found via a live RLS/permissions E2E test
-- against the real preview backend (the non-BUSINESS caller was correctly
-- rejected either way, but for the wrong reason — meaning genuine
-- BUSINESS-plan users could never successfully generate an API key
-- either, since the same ambiguous query runs for them too).
--
-- Fix: qualify the column reference. No behavior change for any caller
-- that was already passing the plan check — only the previously-broken
-- SELECT itself is corrected.
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
  SELECT public.users.plan INTO v_plan FROM public.users WHERE public.users.id = v_uid;
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
