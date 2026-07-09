-- Billing RPC: lets the Cloudflare Worker (lostykk-postulpro) process Lemon
-- Squeezy webhook events over PostgREST using only the public anon key,
-- instead of holding SUPABASE_SERVICE_ROLE_KEY. The Worker verifies the
-- Lemon Squeezy HMAC signature on the raw body itself, then calls this RPC
-- with a dedicated secret (BILLING_RPC_SECRET, Cloudflare-only — not
-- LEMON_SQUEEZY_API_KEY, not LEMON_SQUEEZY_WEBHOOK_SECRET, not
-- SUPABASE_SERVICE_ROLE_KEY, not any user/JWT secret). Only that secret's
-- SHA-256 hash is stored server-side; the raw value never touches this repo,
-- a commit, or a query sent to any tool.
--
-- Applied directly to the project via query_database when built (not run
-- through `supabase db push` — see project_postulpro_lovable_backend memory
-- for why). Kept here for schema history / reproducibility. Re-running this
-- file will recreate the function and table with a placeholder hash that
-- will NOT match the real BILLING_RPC_SECRET until the hash is set for real
-- (see the INSERT below).

CREATE TABLE IF NOT EXISTS public.billing_rpc_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE), -- singleton row
  secret_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.billing_rpc_config ENABLE ROW LEVEL SECURITY;
-- RLS with zero policies denies all PostgREST access (anon/authenticated);
-- only the table owner (postgres, used internally by the function below)
-- can read it.
REVOKE ALL ON public.billing_rpc_config FROM PUBLIC, anon, authenticated;

-- Placeholder — the real deploy sets this to sha256(BILLING_RPC_SECRET) hex,
-- computed locally and never transmitted in raw form. Re-running this file
-- as-is does NOT restore a working secret; it must be updated separately.
INSERT INTO public.billing_rpc_config (id, secret_hash)
VALUES (TRUE, 'REPLACE_WITH_SHA256_HEX_OF_BILLING_RPC_SECRET')
ON CONFLICT (id) DO NOTHING;

-- Lemon Squeezy billing RPC. Mirrors the switch/case logic that used to
-- live directly in src/routes/api/billing/webhook.ts (before it needed
-- SUPABASE_SERVICE_ROLE_KEY). SECURITY DEFINER + explicit search_path lets
-- it bypass RLS on subscriptions/users/lemon_squeezy_events/
-- affiliate_referrals the same way existing functions like reserve_credits
-- already do (owned by postgres). Never builds dynamic SQL from webhook
-- data; event_name is checked against a strict allowlist before any
-- branching, and variant ids are compared as literals, never interpolated.
CREATE OR REPLACE FUNCTION public.process_lemon_squeezy_event(
  p_secret TEXT,
  p_event_id TEXT,
  p_event_name TEXT,
  p_user_id UUID,
  p_provider_subscription_id TEXT,
  p_variant_id TEXT,
  p_customer_id TEXT,
  p_product_id TEXT,
  p_status TEXT,
  p_renews_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_trial_ends_at TIMESTAMPTZ,
  p_cancelled BOOLEAN,
  p_order_paid BOOLEAN,
  p_invoice_total INTEGER
)
RETURNS TABLE(
  ok BOOLEAN,
  message TEXT,
  notify_email TEXT,
  notify_kind TEXT,
  notify_plan TEXT,
  notify_commission NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stored_hash TEXT;
  v_plan TEXT;
  v_interval TEXT;
  v_credits_limit INT;
  v_expired_user UUID;
  v_referral RECORD;
  v_amount_paid NUMERIC;
  v_commission NUMERIC;
  v_notify_email TEXT;
  v_notify_kind TEXT;
BEGIN
  -- 1. Internal secret check — compared only via SHA-256 hash, raw value
  -- never persisted.
  SELECT secret_hash INTO v_stored_hash FROM public.billing_rpc_config WHERE id = TRUE;
  IF p_secret IS NULL OR v_stored_hash IS NULL OR encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_stored_hash THEN
    RETURN QUERY SELECT FALSE, 'unauthorized'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  -- 2. event_name allowlist — literal comparison only, never dynamic SQL.
  IF p_event_name NOT IN (
    'order_created','subscription_created','subscription_updated',
    'subscription_cancelled','subscription_resumed','subscription_expired',
    'subscription_paused','subscription_unpaused',
    'subscription_payment_success','subscription_payment_failed'
  ) THEN
    RETURN QUERY SELECT FALSE, 'unknown event_name'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  IF p_event_id IS NULL OR length(p_event_id) <> 64 THEN
    RETURN QUERY SELECT FALSE, 'invalid event_id'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END IF;

  -- 3. Idempotency ledger. Unique violation = already processed; the whole
  -- function body is one implicit transaction, so this and the mutations
  -- below commit or roll back together.
  BEGIN
    INSERT INTO public.lemon_squeezy_events (id, event_name) VALUES (p_event_id, p_event_name);
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT TRUE, 'already processed'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::NUMERIC;
    RETURN;
  END;

  -- 4. Per-event mutations.
  CASE p_event_name
    WHEN 'order_created' THEN
      IF p_order_paid AND p_user_id IS NOT NULL AND p_variant_id = '1882329' THEN
        UPDATE public.users SET credits_limit = credits_limit + 100 WHERE id = p_user_id;
      END IF;

    WHEN 'subscription_created', 'subscription_updated' THEN
      IF p_user_id IS NOT NULL THEN
        v_plan := CASE p_variant_id
          WHEN '1879841' THEN 'pro' WHEN '1879894' THEN 'pro'
          WHEN '1882316' THEN 'business' WHEN '1882302' THEN 'business'
          ELSE NULL END;
        v_interval := CASE p_variant_id
          WHEN '1879841' THEN 'month' WHEN '1879894' THEN 'year'
          WHEN '1882316' THEN 'month' WHEN '1882302' THEN 'year'
          ELSE NULL END;

        INSERT INTO public.subscriptions (
          user_id, provider, provider_customer_id, provider_subscription_id,
          product_id, variant_id, plan, status, billing_interval,
          renews_at, ends_at, trial_ends_at, cancelled
        ) VALUES (
          p_user_id, 'lemon_squeezy', p_customer_id, p_provider_subscription_id,
          p_product_id, p_variant_id, v_plan, p_status, v_interval,
          p_renews_at, p_ends_at, p_trial_ends_at, COALESCE(p_cancelled, FALSE)
        )
        -- Must match the partial unique index exactly (see
        -- subscriptions_provider_subscription_id_key in the earlier
        -- 20260707000000_lemon_squeezy_billing.sql migration) or Postgres
        -- rejects the ON CONFLICT target with 42P10.
        ON CONFLICT (provider_subscription_id) WHERE provider_subscription_id IS NOT NULL DO UPDATE SET
          provider_customer_id = EXCLUDED.provider_customer_id,
          product_id = EXCLUDED.product_id,
          variant_id = EXCLUDED.variant_id,
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          billing_interval = EXCLUDED.billing_interval,
          renews_at = EXCLUDED.renews_at,
          ends_at = EXCLUDED.ends_at,
          trial_ends_at = EXCLUDED.trial_ends_at,
          cancelled = EXCLUDED.cancelled;

        IF v_plan IS NOT NULL THEN
          v_credits_limit := CASE v_plan WHEN 'business' THEN 500 ELSE 100 END;
          UPDATE public.users SET plan = v_plan, credits_limit = v_credits_limit WHERE id = p_user_id;

          IF p_event_name = 'subscription_created' THEN
            SELECT email INTO v_notify_email FROM public.users WHERE id = p_user_id;
            v_notify_kind := 'pro_confirmation';
          END IF;
        END IF;
      END IF;

    WHEN 'subscription_cancelled' THEN
      UPDATE public.subscriptions SET status = p_status, cancelled = TRUE, ends_at = p_ends_at
      WHERE provider_subscription_id = p_provider_subscription_id;

    WHEN 'subscription_resumed' THEN
      UPDATE public.subscriptions SET status = p_status, cancelled = FALSE, ends_at = NULL
      WHERE provider_subscription_id = p_provider_subscription_id;

    WHEN 'subscription_expired' THEN
      UPDATE public.subscriptions SET status = 'expired'
      WHERE provider_subscription_id = p_provider_subscription_id
      RETURNING user_id INTO v_expired_user;
      v_expired_user := COALESCE(p_user_id, v_expired_user);
      IF v_expired_user IS NOT NULL THEN
        UPDATE public.users SET plan = 'free', credits_limit = 10 WHERE id = v_expired_user;
      END IF;

    WHEN 'subscription_paused', 'subscription_unpaused' THEN
      UPDATE public.subscriptions SET status = p_status
      WHERE provider_subscription_id = p_provider_subscription_id;

    WHEN 'subscription_payment_success' THEN
      -- Recurring commission: if the paying user was referred, credit their
      -- referrer commission_amount = invoice amount * rate.
      SELECT ar.* INTO v_referral FROM public.affiliate_referrals ar
      JOIN public.subscriptions s ON s.user_id = ar.referred_user_id
      WHERE s.provider_subscription_id = p_provider_subscription_id
      LIMIT 1;
      IF FOUND AND v_referral.commission_rate IS NOT NULL THEN
        v_amount_paid := COALESCE(p_invoice_total, 0) / 100.0;
        v_commission := v_amount_paid * (v_referral.commission_rate / 100.0);
        UPDATE public.affiliate_referrals
        SET commission_amount = COALESCE(commission_amount, 0) + v_commission
        WHERE id = v_referral.id;

        SELECT email INTO v_notify_email FROM public.users WHERE id = v_referral.referrer_id;
        v_notify_kind := 'commission';
      END IF;

    WHEN 'subscription_payment_failed' THEN
      SELECT user_id INTO v_expired_user FROM public.subscriptions
      WHERE provider_subscription_id = p_provider_subscription_id;
      IF v_expired_user IS NOT NULL THEN
        SELECT email INTO v_notify_email FROM public.users WHERE id = v_expired_user;
        v_notify_kind := 'payment_failed';
      END IF;

    ELSE
      NULL;
  END CASE;

  RETURN QUERY SELECT TRUE, 'ok'::TEXT, v_notify_email, v_notify_kind, v_plan, v_commission;
END;
$function$;

-- Least privilege: only the anon role (what the Worker authenticates as,
-- server-to-server, no user JWT) may call this. Not authenticated, not
-- public — an authenticated user's own JWT cannot invoke this RPC at all,
-- and even anon callers without the correct secret get 'unauthorized'.
REVOKE ALL ON FUNCTION public.process_lemon_squeezy_event FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_lemon_squeezy_event FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_lemon_squeezy_event TO anon;
