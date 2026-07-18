-- Preview-only publishing for the landing_page_v2 builder (Fase L). The
-- working document lives in generations.edited_output like every other
-- deliverable (zero credit to view/edit/save — see 20260721000000). This
-- table is a separate, deliberately narrow snapshot used only to serve a
-- public, unauthenticated /p/:slug preview page — it never exposes the
-- generations table (owner id, project linkage, other tool outputs) to
-- anonymous visitors, only what's needed to render one published page.

CREATE TABLE public.landing_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  generation_id UUID NOT NULL REFERENCES public.generations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  data JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT landing_publications_generation_unique UNIQUE (generation_id),
  CONSTRAINT landing_publications_slug_unique UNIQUE (slug)
);
CREATE INDEX landing_publications_slug_published_idx
  ON public.landing_publications (slug) WHERE status = 'published';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.landing_publications TO authenticated;
GRANT ALL ON public.landing_publications TO service_role;
ALTER TABLE public.landing_publications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own landing publications" ON public.landing_publications FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id);

-- Owner-only publish: validates slug shape, ownership of the source
-- generation, and resolves slug conflicts with a friendly error rather than
-- a raw unique-constraint violation.
CREATE OR REPLACE FUNCTION public.publish_landing_page(
  p_generation_id UUID,
  p_slug TEXT,
  p_data JSONB
) RETURNS TABLE(slug TEXT, published_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
  v_slug TEXT := lower(trim(p_slug));
  v_conflict_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id INTO v_owner FROM public.generations WHERE id = p_generation_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Generation not found'; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF v_slug !~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid slug: use lowercase letters, numbers and hyphens (3-60 chars)';
  END IF;

  SELECT id INTO v_conflict_id FROM public.landing_publications
    WHERE landing_publications.slug = v_slug AND generation_id <> p_generation_id;
  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'That link is already taken — choose a different slug';
  END IF;

  INSERT INTO public.landing_publications (user_id, generation_id, slug, status, data, published_at, updated_at)
  VALUES (v_uid, p_generation_id, v_slug, 'published', p_data, v_now, v_now)
  ON CONFLICT (generation_id) DO UPDATE
    SET slug = v_slug, status = 'published', data = p_data, published_at = v_now, updated_at = v_now;

  RETURN QUERY SELECT v_slug, v_now;
END;
$$;
GRANT EXECUTE ON FUNCTION public.publish_landing_page(UUID, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.unpublish_landing_page(p_generation_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_owner UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT user_id INTO v_owner FROM public.landing_publications WHERE generation_id = p_generation_id;
  IF v_owner IS NULL THEN RETURN; END IF;
  IF v_owner <> v_uid THEN RAISE EXCEPTION 'Forbidden'; END IF;

  UPDATE public.landing_publications SET status = 'draft', updated_at = NOW()
    WHERE generation_id = p_generation_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.unpublish_landing_page(UUID) TO authenticated;

-- Anonymous, read-only lookup for the public /p/:slug page. Returns only
-- the rendering payload — no user_id, no generation_id, nothing that
-- identifies the owner or links back to their private project data.
CREATE OR REPLACE FUNCTION public.get_published_landing(p_slug TEXT)
RETURNS TABLE(data JSONB, published_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT lp.data, lp.published_at
  FROM public.landing_publications lp
  WHERE lp.slug = lower(trim(p_slug)) AND lp.status = 'published';
$$;
GRANT EXECUTE ON FUNCTION public.get_published_landing(TEXT) TO anon, authenticated;
