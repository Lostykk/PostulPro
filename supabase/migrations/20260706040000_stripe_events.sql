-- Fase 5: idempotency ledger for processed Stripe webhook events, so a
-- retried delivery (Stripe retries on non-2xx, and can also just double-send)
-- can never apply the same event twice.
CREATE TABLE public.stripe_events (
  id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.stripe_events TO service_role;
-- No grants to anon/authenticated: only the webhook handler (service role)
-- ever touches this table.
