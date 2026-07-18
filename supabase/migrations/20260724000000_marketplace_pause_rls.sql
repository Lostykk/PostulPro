-- Fase 2: Marketplace paused pre-launch. The app-level MARKETPLACE_ENABLED
-- flag (src/lib/features.ts) already hides every UI entry point and
-- redirects /marketplace/* away, but "Seller manage own products" was a
-- single FOR ALL policy letting any authenticated user INSERT a new
-- product row regardless of plan — publish gating was client-side only
-- (marketplace.sell.tsx). This closes that at the RLS layer too: no new
-- products can be listed by non-admins while paused, while sellers keep
-- the ability to edit/remove their own existing listings.
--
-- Reversible: drop these three policies and restore the original
-- "Seller manage own products" FOR ALL policy from
-- 20260704231647_e9fe9c0c-...sql to re-enable seller-initiated inserts.
DROP POLICY IF EXISTS "Seller manage own products" ON public.products;

CREATE POLICY "Seller update own products" ON public.products FOR UPDATE TO authenticated
  USING (auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Seller delete own products" ON public.products FOR DELETE TO authenticated
  USING (auth.uid() = seller_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin insert products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
