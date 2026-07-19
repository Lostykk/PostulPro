-- Rollback for supabase/migrations/20260727000000_credit_reservations_idempotent_refund.sql
--
-- Safe to run at any time as long as the application code
-- (generate-ai.ts / executor.server.ts) has been reverted to call
-- reserve_credits/refund_credits FIRST — those two functions were never
-- touched by the forward migration and remain fully functional
-- throughout. Running this rollback while the app still calls the new
-- RPCs would simply make those calls fail (function not found), the
-- same as any other missing-migration state.
--
-- No pre-existing data is lost: credit_reservations is new data
-- introduced only after the forward migration ran. Dropping it discards
-- the reservation audit log accumulated since, nothing else.

DROP FUNCTION IF EXISTS public.reconcile_stale_reservations(INT);
DROP FUNCTION IF EXISTS public.resolve_credit_reservation(UUID, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.reserve_credits_v2(INT, TEXT);
DROP POLICY IF EXISTS "Own credit reservations" ON public.credit_reservations;
DROP TABLE IF EXISTS public.credit_reservations;
