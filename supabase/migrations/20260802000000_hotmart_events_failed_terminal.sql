-- Fase 5 (autonomous entitlement recovery): adds a dead-letter terminal
-- state for hotmart_events, and starts giving real meaning to the
-- already-existing (but previously unused) processing_attempts column.
--
-- Context: a real purchase (HP2883966668, see
-- docs/hotmart-integration-report.md §5) was hard-rejected twice by a
-- currency equality check that has since been removed (see
-- 20260731000000_hotmart_events_status_expansion.sql's sibling code change
-- in src/routes/api/webhooks/hotmart.ts). The user explicitly rejected any
-- recovery path that requires a manual Hotmart resend, a founder-run
-- script, or exposing a secret -- the recovery must happen automatically,
-- from already-stored ledger data, via an internal reconciler
-- (tasks/reconcile-hotmart.ts). That reconciler replays 'failed' /
-- 'pending_link' rows through the exact same processEvent logic the public
-- webhook uses (see process-event.server.ts) -- which is safe (SET, never
-- increment, semantics in process_hotmart_event) but must not retry a
-- permanently-broken row forever. 'failed_terminal' is that stop: once
-- processing_attempts reaches the reconciler's own cap (5), the row is
-- flipped here instead of being retried again, keeping it visible for
-- admin review without an unbounded retry loop.
--
-- Deliberately additive: no existing row or value is touched, exactly like
-- 20260731000000's own expansion.

ALTER TABLE public.hotmart_events DROP CONSTRAINT hotmart_events_processing_status_check;

ALTER TABLE public.hotmart_events ADD CONSTRAINT hotmart_events_processing_status_check
  CHECK (processing_status IN (
    'pending',
    'processed',
    'ignored',
    'error',
    'ignored_test',
    'unsupported',
    'unmapped_offer',
    'no_action_required',
    'invalid_payload',
    'pending_link',
    'failed',
    'failed_terminal'    -- new: reconciler gave up after too many attempts, held for admin review, never auto-retried again
  ));

CREATE INDEX IF NOT EXISTS hotmart_events_reconcile_candidates_idx
  ON public.hotmart_events (processing_status, received_at)
  WHERE processing_status IN ('failed', 'pending_link');
