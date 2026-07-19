-- Rollback for supabase/migrations/20260728000000_reservation_job_evidence.sql
--
-- Safe to run at any time as long as application code has been reverted
-- to stop calling mark_reservation_job_outcome and stop setting
-- generations.credit_reservation_id at insert time — both are additive
-- and nothing else in the already-applied 20260727000000 migration
-- depends on them. reconcile_stale_reservations (the original, blind-by-
-- age one) is untouched by the forward migration and remains available
-- throughout, unaffected by this rollback.
--
-- No pre-existing data is lost: credit_reservation_id, job_outcome,
-- job_outcome_reason, and job_outcome_at are all new, nullable columns
-- introduced only after the forward migration ran. Dropping them discards
-- only the reconciliation evidence accumulated since, nothing else —
-- existing reservations and generations rows themselves are untouched.

DROP FUNCTION IF EXISTS public.reconcile_stale_reservations_v2(INT);
DROP FUNCTION IF EXISTS public.mark_reservation_job_outcome(UUID, TEXT, TEXT);
DROP INDEX IF EXISTS public.idx_generations_credit_reservation_id;
ALTER TABLE public.credit_reservations
  DROP COLUMN IF EXISTS job_outcome,
  DROP COLUMN IF EXISTS job_outcome_reason,
  DROP COLUMN IF EXISTS job_outcome_at;
ALTER TABLE public.generations
  DROP COLUMN IF EXISTS credit_reservation_id;
