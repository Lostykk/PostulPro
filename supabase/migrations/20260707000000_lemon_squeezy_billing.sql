-- Billing provider migration: Stripe -> Lemon Squeezy.
--
-- Evidence checked on the remote project before writing this migration
-- (2026-07-06): `select count(*) from stripe_events` = 0,
-- `select count(*) from subscriptions` = 0, and no row in `purchases` has
-- `stripe_payment_id` set. Stripe was never wired to a live store, so there
-- is no historical billing data to preserve. That is what allows the
-- destructive parts below (dropping stripe_events, renaming columns) to be
-- done directly rather than via an additive-only column-preserving path.
--
-- `purchases.stripe_payment_id` is intentionally left untouched: it belongs
-- to the marketplace one-time-purchase flow, which was never wired to any
-- payment provider (still a placeholder toast in the UI) and is out of
-- scope for this subscriptions/credits billing migration.

-- SUBSCRIPTIONS: rename provider-specific columns to provider-neutral ones
-- and add the fields Lemon Squeezy's subscription object needs to sync.
ALTER TABLE public.subscriptions RENAME COLUMN stripe_customer_id TO provider_customer_id;
ALTER TABLE public.subscriptions RENAME COLUMN stripe_subscription_id TO provider_subscription_id;
ALTER TABLE public.subscriptions RENAME COLUMN current_period_end TO renews_at;

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'lemon_squeezy';
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS product_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS variant_id TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT CHECK (billing_interval IN ('month', 'year'));
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per provider subscription: the webhook upserts by this key.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_subscription_id_key
  ON public.subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- Provider-neutral webhook idempotency ledger, replacing stripe_events.
-- Lemon Squeezy doesn't hand out a stable per-delivery event id in the
-- payload the way Stripe does, so the webhook handler uses sha256(raw body)
-- as the id: a genuine retry/duplicate delivery is byte-identical and
-- hashes the same, while any real state change hashes differently.
CREATE TABLE public.lemon_squeezy_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.lemon_squeezy_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.lemon_squeezy_events TO service_role;
-- No grants to anon/authenticated: only the webhook handler (service role)
-- ever touches this table.

-- stripe_events had zero rows (verified above) and nothing in the
-- application still writes to it after this migration — safe to drop
-- rather than keep as permanent dead weight.
DROP TABLE IF EXISTS public.stripe_events;
