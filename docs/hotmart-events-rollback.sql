-- Rollback for:
--   supabase/migrations/20260729000000_hotmart_events.sql
--   supabase/migrations/20260729010000_process_hotmart_event_rpc.sql
--   supabase/migrations/20260729020000_webhook_rate_limit.sql
--   supabase/migrations/20260729030000_admin_resolve_hotmart_pending_link.sql
--   supabase/migrations/20260729040000_reconcile_hotmart_stale.sql
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

-- 4. Generic webhook rate limiter (independent of the two above — safe to
--    drop in any order relative to them, listed last only to match
--    migration file order).
DROP FUNCTION IF EXISTS public.claim_webhook_rate_limit(TEXT, TEXT, INT, INT);
DROP TABLE IF EXISTS public.webhook_rate_limit_events;

-- 5. Admin pending-link resolver (depends only on hotmart_events /
--    hotmart_pending_links, already dropped above by the time this runs
--    if executed top-to-bottom -- listed last to match file order, but
--    safe to drop in any order since it has no table of its own).
DROP FUNCTION IF EXISTS public.admin_resolve_hotmart_pending_link(UUID, UUID, TEXT, TEXT, INT);

-- 6. Commercial reconciliation function (independent, no table of its own).
DROP FUNCTION IF EXISTS public.reconcile_hotmart_stale(INT);

-- Nothing else to revert: no columns were added to any existing table,
-- no existing function was replaced (process_lemon_squeezy_event,
-- admin_update_user_plan, claim_plan_rate_limit, and
-- reconcile_stale_reservations_v2 are all untouched by these five
-- migrations), no existing RLS policy or grant was changed.
