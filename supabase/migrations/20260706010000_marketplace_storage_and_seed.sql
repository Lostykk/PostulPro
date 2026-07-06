-- Fase 4: Marketplace storage + seller plan enforcement + seed products.

-- SECURITY FIX: the original "Seller manage own products" policy let ANY
-- authenticated user insert a product as long as seller_id = auth.uid() —
-- it never checked plan, so a free/pro user could sell. Only BUSINESS can.
DROP POLICY IF EXISTS "Seller manage own products" ON public.products;
CREATE POLICY "Seller manage own products" ON public.products FOR ALL TO authenticated
  USING (auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      auth.uid() = seller_id
      AND (SELECT plan FROM public.users WHERE id = auth.uid()) = 'business'
    )
  );

-- Storage buckets: thumbnails are public (shown in the marketplace grid
-- without requiring a purchase); product files are private and only
-- readable by the seller or a buyer who actually purchased that product.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-thumbnails', 'product-thumbnails', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-files', 'product-files', FALSE)
ON CONFLICT (id) DO NOTHING;

-- Convention: object path is "{product_id}/{filename}" in both buckets.
CREATE POLICY "Public read thumbnails" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-thumbnails');

CREATE POLICY "Sellers manage own thumbnails" ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'product-thumbnails'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id::text = (storage.foldername(name))[1] AND p.seller_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'product-thumbnails'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id::text = (storage.foldername(name))[1] AND p.seller_id = auth.uid()
    )
  );

CREATE POLICY "Sellers manage own product files" ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id::text = (storage.foldername(name))[1] AND p.seller_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id::text = (storage.foldername(name))[1] AND p.seller_id = auth.uid()
    )
  );

CREATE POLICY "Buyers read purchased product files" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'product-files'
    AND EXISTS (
      SELECT 1 FROM public.purchases pu
      JOIN public.products p ON p.id = pu.product_id
      WHERE p.id::text = (storage.foldername(name))[1] AND pu.user_id = auth.uid()
    )
  );

-- Seed products, owned by the workspace owner account if it already exists
-- in this Supabase project. Idempotent: safe to re-run, and a no-op (not an
-- error) if the owner hasn't signed up in this project yet — re-run this
-- migration after they do.
INSERT INTO public.products (seller_id, title, description, category, price, is_published)
SELECT u.id, 'Pack 50 Prompts de Marketing IA', 'Cincuenta prompts probados para generar copy, campañas y contenido con IA.', 'Prompt Pack', 19.00, TRUE
FROM auth.users u
WHERE u.email = 'mig.chec@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.products WHERE title = 'Pack 50 Prompts de Marketing IA');

INSERT INTO public.products (seller_id, title, description, category, price, is_published)
SELECT u.id, 'Plantilla de Plan de Negocios PRO', 'Plantilla editable para estructurar tu plan de negocios de punta a punta.', 'Template', 29.00, TRUE
FROM auth.users u
WHERE u.email = 'mig.chec@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.products WHERE title = 'Plantilla de Plan de Negocios PRO');

INSERT INTO public.products (seller_id, title, description, category, price, is_published)
SELECT u.id, 'Guía: Monetiza tu Conocimiento con IA', 'Guía paso a paso para convertir tu expertise en un producto digital rentable.', 'Guía', 39.00, TRUE
FROM auth.users u
WHERE u.email = 'mig.chec@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.products WHERE title = 'Guía: Monetiza tu Conocimiento con IA');

INSERT INTO public.products (seller_id, title, description, category, price, is_published)
SELECT u.id, 'Swipe File: 100 Emails de Ventas que Convierten', 'Cien emails de venta reales para adaptar a tu producto o servicio.', 'Swipe File', 49.00, TRUE
FROM auth.users u
WHERE u.email = 'mig.chec@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.products WHERE title = 'Swipe File: 100 Emails de Ventas que Convierten');

INSERT INTO public.products (seller_id, title, description, category, price, is_published)
SELECT u.id, 'Mini Curso: Tu Primer $1000 con IA', 'Curso corto y accionable para generar tus primeros ingresos usando herramientas de IA.', 'Curso', 97.00, TRUE
FROM auth.users u
WHERE u.email = 'mig.chec@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.products WHERE title = 'Mini Curso: Tu Primer $1000 con IA');
