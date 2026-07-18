-- Storage for landing builder section images (Fase I). Public (the whole
-- point is these render in an exported/published landing page, including to
-- anonymous visitors on /p/:slug), so the same stored-XSS guard as
-- avatars/product-thumbnails applies: no SVG, size-capped, safe raster
-- formats only. Object path convention: "{user_id}/{filename}".

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('landing-images', 'landing-images', TRUE, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read landing images" ON storage.objects FOR SELECT
  USING (bucket_id = 'landing-images');

CREATE POLICY "Owners manage own landing images" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'landing-images' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'landing-images' AND (storage.foldername(name))[1] = auth.uid()::text);
