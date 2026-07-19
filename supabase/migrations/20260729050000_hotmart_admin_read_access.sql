-- Fase J (admin observability): read-only access to hotmart_events and
-- hotmart_pending_links for admins, through the app itself. Both tables
-- currently have zero grants to `authenticated` at all (fully locked,
-- even to an admin) -- correct for the webhook's own write path
-- (service_role only) but leaves no way for the admin UI to list events,
-- see what's pending/failed, or review a purchase awaiting manual
-- linking without going around Supabase directly.
--
-- SELECT only. No INSERT/UPDATE/DELETE grant added for either table:
-- every mutation an admin can make (resolving a pending link, and in a
-- later round, retrying a failed event) goes exclusively through a
-- SECURITY DEFINER RPC that validates the transition and can't be used
-- to invent a transaction, edit a payload, or grant arbitrary credits --
-- see admin_resolve_hotmart_pending_link
-- (20260729030000_admin_resolve_hotmart_pending_link.sql). A direct table
-- UPDATE from the client, even an admin one, is never how state changes
-- here, matching the same posture already established for
-- credit_reservations and other financially-sensitive tables in this
-- project.

CREATE POLICY "Admin read hotmart_events" ON public.hotmart_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.hotmart_events TO authenticated;

CREATE POLICY "Admin read hotmart_pending_links" ON public.hotmart_pending_links
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.hotmart_pending_links TO authenticated;
