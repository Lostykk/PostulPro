-- Out-of-order webhook protection for subscription lifecycle events.
--
-- process_lemon_squeezy_event() previously applied every subscription_*
-- event as a blind UPDATE/UPSERT keyed only by provider_subscription_id.
-- Lemon Squeezy (like most webhook providers) does not guarantee delivery
-- order — a retried or delayed delivery of an older event (e.g. a stale
-- "still active" subscription_updated) can arrive after a newer one (e.g.
-- subscription_cancelled) and silently overwrite the more recent, correct
-- state. This adds a per-subscription "last applied provider timestamp"
-- and guards every subscription_* mutation with it, so an older event can
-- never regress state a newer event already applied.
--
-- Applied directly via query_database when built — see
-- project_postulpro_lovable_backend memory for why. Kept here for schema
-- history / reproducibility, same pattern as 20260709000000_billing_rpc.sql.

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider_updated_at TIMESTAMPTZ;

DROP FUNCTION IF EXISTS public.process_lemon_squeezy_event(text,text,text,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,boolean,integer);

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
  p_invoice_total INTEGER,
  p_provider_updated_at TIMESTAMPTZ DEFAULT NULL
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
          renews_at, ends_at, trial_ends_at, cancelled, provider_updated_at
        ) VALUES (
          p_user_id, 'lemon_squeezy', p_customer_id, p_provider_subscription_id,
          p_product_id, p_variant_id, v_plan, p_status, v_interval,
          p_renews_at, p_ends_at, p_trial_ends_at, COALESCE(p_cancelled, FALSE), p_provider_updated_at
        )
        -- Must match the partial unique index exactly (see
        -- subscriptions_provider_subscription_id_key in the earlier
        -- 20260707000000_lemon_squeezy_billing.sql migration) or Postgres
        -- rejects the ON CONFLICT target with 42P10.
        --
        -- The WHERE clause on DO UPDATE is the out-of-order guard: skip
        -- applying this event's fields if a newer-timestamped event already
        -- landed. NULL-safe on both sides so rows/events predating this
        -- column (or a provider payload missing updated_at) never get
        -- stuck unable to update.
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
          cancelled = EXCLUDED.cancelled,
          provider_updated_at = EXCLUDED.provider_updated_at
        WHERE EXCLUDED.provider_updated_at IS NULL
           OR public.subscriptions.provider_updated_at IS NULL
           OR EXCLUDED.provider_updated_at >= public.subscriptions.provider_updated_at;

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
      UPDATE public.subscriptions SET status = p_status, cancelled = TRUE, ends_at = p_ends_at, provider_updated_at = p_provider_updated_at
      WHERE provider_subscription_id = p_provider_subscription_id
        AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at);

    WHEN 'subscription_resumed' THEN
      UPDATE public.subscriptions SET status = p_status, cancelled = FALSE, ends_at = NULL, provider_updated_at = p_provider_updated_at
      WHERE provider_subscription_id = p_provider_subscription_id
        AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at);

    WHEN 'subscription_expired' THEN
      UPDATE public.subscriptions SET status = 'expired', provider_updated_at = COALESCE(p_provider_updated_at, provider_updated_at)
      WHERE provider_subscription_id = p_provider_subscription_id
        AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at)
      RETURNING user_id INTO v_expired_user;
      v_expired_user := COALESCE(v_expired_user, p_user_id);
      IF v_expired_user IS NOT NULL THEN
        UPDATE public.users SET plan = 'free', credits_limit = 10 WHERE id = v_expired_user;
      END IF;

    WHEN 'subscription_paused', 'subscription_unpaused' THEN
      UPDATE public.subscriptions SET status = p_status, provider_updated_at = p_provider_updated_at
      WHERE provider_subscription_id = p_provider_subscription_id
        AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at);

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

-- Least privilege unchanged by this migration — same grants as before.
REVOKE ALL ON FUNCTION public.process_lemon_squeezy_event FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_lemon_squeezy_event FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_lemon_squeezy_event TO anon;
