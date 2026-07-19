-- Rollback for:
--   supabase/migrations/20260729000000_hotmart_events.sql
--   supabase/migrations/20260729010000_process_hotmart_event_rpc.sql
--
-- Safe by construction: both migrations only CREATE new objects (no
-- ALTER/rename/drop of any pre-existing table, column, or function). This
-- rollback only removes what those two migrations added -- it never
-- touches public.users, public.subscriptions, public.billing_history,
-- public.billing_rpc_config, or any Lemon Squeezy object. Run only if
-- these migrations are applied and need to be undone before Hotmart goes
-- live; not needed for local-only, unapplied files.
--
-- Order matters: hotmart_pending_links has a FOREIGN KEY to
-- hotmart_events, so it must be dropped first (or use CASCADE on
-- hotmart_events, but dropping explicitly in order is clearer and doesn't
-- rely on CASCADE silently taking out something unexpected later).

-- 1. Function first (depends on nothing else being dropped, but drop
--    before the tables it reads/writes so nothing can call it mid-rollback).
DROP FUNCTION IF EXISTS public.process_hotmart_event(
  TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT,
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
);

-- 2. Child table (FK -> hotmart_events) before the parent.
DROP TABLE IF EXISTS public.hotmart_pending_links;

-- 3. Parent table last.
DROP TABLE IF EXISTS public.hotmart_events;

-- Nothing else to revert: no columns were added to any existing table,
-- no existing function was replaced (process_lemon_squeezy_event and
-- admin_update_user_plan are both untouched by these two migrations), no
-- existing RLS policy or grant was changed.
