-- Fase 5 follow-up: a real timing race exposed a gap in the automatic
-- reconciler. Two real hotmart_events rows (transaction HP2883966668) hit
-- the 5-attempt cap and moved to 'failed_terminal' BEFORE a since-fixed
-- infrastructure bug (process_hotmart_event's RPC call omitting
-- p_renews_at/p_ends_at, see process-event.server.ts) was deployed --
-- meaning the fix arrived correct, but too late for these two specific
-- rows, which the reconciler deliberately never revisits once terminal.
--
-- Generic reasoning (not a one-off fix for this transaction): every row
-- that ever reaches 'failed' or 'failed_terminal' got there via
-- processEvent's OWN classification, which reserves distinct states
-- (unmapped_offer, invalid_payload, unsupported, no_action_required) for
-- genuine business/data rejections -- 'failed'/'failed_terminal' is
-- reserved exclusively for technical failures (RPC/DB/transport errors,
-- buyer-resolution failures). By construction, EVERY failed_terminal row
-- is already known to be a technical-class failure, never a business
-- rejection -- so a second, tightly bounded reconciliation tier for
-- failed_terminal rows is safe in general, not just for this incident.
--
-- terminal_reconcile_attempts is a SEPARATE counter from
-- processing_attempts (which stays capped at 5 for the first tier) --
-- capped independently (see reconcile-hotmart.server.ts's
-- MAX_TERMINAL_RECONCILE_ATTEMPTS) so a genuinely permanently-broken row
-- still reaches a true, final dead end instead of retrying forever.

ALTER TABLE public.hotmart_events
  ADD COLUMN IF NOT EXISTS terminal_reconcile_attempts INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS hotmart_events_terminal_reconcile_candidates_idx
  ON public.hotmart_events (processing_status, received_at)
  WHERE processing_status = 'failed_terminal';
