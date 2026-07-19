-- Fase 8C: widen hotmart_events.processing_status to the richer state
-- ontology required after rebuilding the normalizer/idempotency contract
-- (see docs/hotmart-integration-report.md §24-26). The old 4-value CHECK
-- ('pending', 'processed', 'ignored', 'error') collapsed every kind of
-- "we didn't grant anything" outcome into a single 'ignored'/'error' pair,
-- which is exactly the ambiguity the task's mandate explicitly forbids
-- ("Nunca uses `ignored` como resultado genérico para errores de
-- normalización").
--
-- Deliberately additive and backward compatible: existing rows using
-- 'pending' / 'processed' / 'ignored' / 'error' remain valid as-is (no
-- backfill needed, no data touched) -- only the allowed value set grows.
-- 'ignored' and 'error' are kept in the CHECK (not removed) so any row
-- already written by the pre-Fase-8C code, or by reconcile_hotmart_stale
-- (which still writes 'error' for stuck-pending rows -- unchanged by this
-- migration), stays valid.
--
-- New values and what each means for the ROW itself (not the per-request
-- HTTP response, which uses a wider "result" vocabulary that additionally
-- includes "duplicate" -- a fact about a REDELIVERY, not about the row;
-- see the Worker route):
--   ignored_test      -- recognized as a Hotmart test/sandbox payload
--                         (see normalize.ts's isLikelyTestPayload), ledgered
--                         for audit, zero commercial effect by design.
--   unsupported       -- authenticated, structurally valid `data` block,
--                         but the event/status value itself isn't in any
--                         known mapping. Needs admin review; never a
--                         guessed financial action.
--   unmapped_offer    -- authenticated, event fully understood (e.g. a
--                         real purchase_approved), but product_id/offer_id
--                         doesn't match any configured HOTMART_OFFER_PLAN_MAP
--                         entry. Distinct from unsupported: this is a
--                         config/catalog mismatch, not an unrecognized
--                         event shape.
--   no_action_required -- recognized event/status that deliberately causes
--                         no mutation (e.g. a boleto being printed,
--                         waiting_payment, an under-review status) --
--                         distinct from unsupported (which means "we don't
--                         know what this is"), this means "we know exactly
--                         what this is and there is genuinely nothing to
--                         do yet".
--   invalid_payload   -- authenticated but missing the minimum expected
--                         structure entirely (no top-level `data`, no
--                         `event`, no resolvable identity at all).
--   pending_link      -- buyer resolution could not complete (see
--                         hotmart_pending_links); parked for admin
--                         resolution via admin_resolve_hotmart_pending_link.
--   failed            -- internal/DB error while processing an otherwise
--                         valid, understood event -- distinct from the
--                         legacy generic 'error' only in that this is the
--                         value the Fase 8C route now writes going
--                         forward; 'error' remains valid for old rows and
--                         for reconcile_hotmart_stale's stuck-pending sweep.

ALTER TABLE public.hotmart_events DROP CONSTRAINT hotmart_events_processing_status_check;

ALTER TABLE public.hotmart_events ADD CONSTRAINT hotmart_events_processing_status_check
  CHECK (processing_status IN (
    'pending',
    'processed',
    'ignored',           -- legacy, kept for old rows
    'error',             -- legacy + reconcile_hotmart_stale's stuck-pending sweep
    'ignored_test',
    'unsupported',
    'unmapped_offer',
    'no_action_required',
    'invalid_payload',
    'pending_link',
    'failed'
  ));
