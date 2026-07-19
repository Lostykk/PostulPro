-- Hotmart integration: webhook event ledger.
--
-- Design decision (see docs/hotmart-integration-report.md §schema): no new
-- "hotmart_subscriptions" table. public.subscriptions is already
-- provider-neutral (provider TEXT, no CHECK restricting its values —
-- verified before writing this migration) and has every column a Hotmart
-- subscription needs: provider_subscription_id <- Hotmart subscriber_code,
-- variant_id <- Hotmart offer_code (both opaque provider identifiers,
-- reused as-is rather than adding Hotmart-specific duplicate columns),
-- product_id <- Hotmart product id, provider_updated_at <- the same
-- out-of-order guard already built for Lemon Squeezy in
-- 20260711000000_subscription_recency_guard.sql. billing_history is reused
-- unchanged (event_type is free-form TEXT, not provider-specific).
--
-- What IS new: hotmart_events, because Hotmart's own idempotency signal is
-- unconfirmed (see report §B) and structurally different from Lemon
-- Squeezy's (a webhook envelope "id" whose stability across retries/resends
-- was never verified against a real Hotmart account). Rather than trust
-- that id alone -- the exact failure mode that bit lemon_squeezy_events
-- (docs/lemon-squeezy-test-validation.md §8, sha256(raw body) broke on
-- Resend) -- this ledger stores enough fields to let the Worker compute a
-- defensive idempotency key (event_type + transaction/subscriber id + a
-- resource timestamp when Hotmart provides one) the same way
-- process_lemon_squeezy_event's eventId already does, without hardcoding
-- that decision into the schema itself.

CREATE TABLE public.hotmart_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Computed by the webhook handler, never trusted from a client-supplied
  -- value: see the Worker route for the exact formula. UNIQUE is what makes
  -- "INSERT ... EXCEPTION unique_violation" the same one-transaction
  -- idempotency pattern every other billing/credits table in this project
  -- already uses.
  idempotency_key TEXT NOT NULL UNIQUE,
  -- Hotmart's own webhook envelope "id" field (2.0.0 payload), kept
  -- separately from idempotency_key for observability/debugging even though
  -- it is not itself trusted as the sole dedupe key.
  external_event_id TEXT,
  event_type TEXT NOT NULL,
  transaction_id TEXT,
  subscription_id TEXT,
  product_id TEXT,
  offer_id TEXT,
  -- Always lowercased + trimmed before insert -- see normalizeEmail() in
  -- the buyer-linking module. Never used to identify an account by itself;
  -- only alongside an explicit linking decision (see report §G).
  buyer_email TEXT,
  buyer_external_id TEXT,
  -- sha256 hex of the raw request body -- audit trail only, deliberately
  -- NOT the idempotency key (that mistake is exactly what
  -- lemon_squeezy_events got wrong initially). Never the raw payload
  -- itself: no card data, no PII beyond what's already duplicated in the
  -- typed columns above, and this column alone can never reconstruct the
  -- original body.
  payload_hash TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processed', 'ignored', 'error')),
  processing_attempts INT NOT NULL DEFAULT 0,
  -- Sanitized exception message only (RPC/DB error text) -- never a raw
  -- stack trace, never a secret, never the full payload.
  last_error TEXT,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action_taken TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX hotmart_events_transaction_id_idx ON public.hotmart_events (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX hotmart_events_subscription_id_idx ON public.hotmart_events (subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX hotmart_events_buyer_email_idx ON public.hotmart_events (buyer_email) WHERE buyer_email IS NOT NULL;
CREATE INDEX hotmart_events_processing_status_idx ON public.hotmart_events (processing_status);
CREATE INDEX hotmart_events_received_at_idx ON public.hotmart_events (received_at);

ALTER TABLE public.hotmart_events ENABLE ROW LEVEL SECURITY;
-- Zero policies + explicit REVOKE = PostgREST denies anon/authenticated
-- entirely, same pattern as lemon_squeezy_events and billing_rpc_config.
-- Only the SECURITY DEFINER RPC (owned by postgres) and service_role
-- (admin observability queries) ever touch this table.
REVOKE ALL ON public.hotmart_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hotmart_events TO service_role;

-- Pending buyer-link table: a Hotmart purchase whose buyer_email does not
-- match any existing public.users row yet. Not merged automatically (see
-- report §G) -- surfaced here for the admin tool to resolve, or for the
-- eventual signup-time auto-claim flow (matched by verified email at
-- signup, never at webhook time). No plan/credits are granted until a row
-- here is resolved to a real user_id.
CREATE TABLE public.hotmart_pending_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotmart_event_id UUID NOT NULL REFERENCES public.hotmart_events(id) ON DELETE CASCADE,
  buyer_email TEXT NOT NULL,
  transaction_id TEXT,
  subscription_id TEXT,
  product_id TEXT,
  offer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolved_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX hotmart_pending_links_email_idx ON public.hotmart_pending_links (buyer_email);
CREATE INDEX hotmart_pending_links_status_idx ON public.hotmart_pending_links (status);
ALTER TABLE public.hotmart_pending_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hotmart_pending_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.hotmart_pending_links TO service_role;
