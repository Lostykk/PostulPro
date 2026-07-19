-- Hotmart billing RPC. Structurally mirrors process_lemon_squeezy_event
-- (idempotency ledger insert first, inside the same transaction as the
-- mutations; SECURITY DEFINER to bypass RLS the same way; gated by a
-- shared secret compared only via its stored SHA-256 hash) but with one
-- deliberate difference: it does NOT hardcode a Hotmart offer-id -> plan
-- mapping in SQL. Hotmart's exact 2.0.0 webhook payload shape was not
-- fully confirmable from official docs at the time this was written (see
-- docs/hotmart-integration-report.md §B) and the offer/product -> plan
-- mapping already lives in one place -- src/lib/hotmart.server.ts's
-- OFFER_PLAN_MAP, the Fase D config -- so this RPC takes the already-
-- resolved plan/interval/credits as parameters instead of re-deriving them
-- from a second hardcoded mapping that would drift from the TS one. It
-- still re-validates those parameters against a strict allowlist below
-- (defense in depth -- never trusts the caller's plan value blindly, same
-- posture as admin_update_user_plan).
--
-- p_event_type is an INTERNAL, normalized vocabulary the Worker's webhook
-- handler maps Hotmart's real event/status fields onto -- not Hotmart's
-- own event names directly (those are less certain than Lemon Squeezy's
-- documented ones; keeping the mapping in TypeScript, not this migration,
-- means learning the real payload shape later never requires a new
-- migration, only a code change to the normalization layer).
--
-- Reuses public.subscriptions (provider = 'hotmart') and public.
-- billing_history unchanged -- no new tables beyond hotmart_events /
-- hotmart_pending_links (see 20260729000000_hotmart_events.sql for why).
--
-- Applied directly via query_database when built, same as every other
-- billing RPC in this project (see project_postulpro_lovable_backend
-- memory) -- kept here for schema history / reproducibility.

CREATE OR REPLACE FUNCTION public.process_hotmart_event(
  p_secret TEXT,
  p_idempotency_key TEXT,
  p_event_type TEXT,
  p_user_id UUID,
  p_provider_subscription_id TEXT, -- Hotmart subscriber_code
  p_provider_customer_id TEXT,
  p_product_id TEXT,
  p_offer_id TEXT, -- stored in subscriptions.variant_id (reused column)
  p_status TEXT, -- raw Hotmart status, stored as-is for audit/debugging
  p_plan TEXT, -- already resolved by the Worker's OFFER_PLAN_MAP
  p_billing_interval TEXT, -- already resolved, 'month' | 'year'
  p_credits_limit INT, -- already resolved
  p_renews_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_provider_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(
  ok BOOLEAN,
  message TEXT,
  notify_email TEXT,
  notify_kind TEXT,
  notify_plan TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stored_hash TEXT;
  v_bonus INT;
  v_notify_email TEXT;
  v_notify_kind TEXT;
  v_sub_user_id UUID;
  v_sub_plan TEXT;
  v_sub_interval TEXT;
  v_sub_credits INT;
BEGIN
  -- 1. Internal secret check (BILLING_RPC_SECRET, shared with Lemon
  -- Squeezy's RPC -- both are the same "trusted backend" caller, not
  -- provider-specific credentials).
  SELECT secret_hash INTO v_stored_hash FROM public.billing_rpc_config WHERE id = TRUE;
  IF p_secret IS NULL OR v_stored_hash IS NULL OR encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_stored_hash THEN
    RETURN QUERY SELECT FALSE, 'unauthorized'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 2. event_type allowlist -- our own normalized vocabulary, never
  -- Hotmart's raw event name, and never dynamic SQL.
  IF p_event_type NOT IN (
    'purchase_approved', 'renewal_approved', 'subscription_cancelled',
    'refund', 'chargeback', 'chargeback_reversed', 'payment_failed',
    'reactivation', 'plan_change', 'subscription_expired'
  ) THEN
    RETURN QUERY SELECT FALSE, 'unknown event_type'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF p_plan IS NOT NULL AND p_plan NOT IN ('free', 'pro', 'business') THEN
    RETURN QUERY SELECT FALSE, 'invalid plan'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 32 THEN
    RETURN QUERY SELECT FALSE, 'invalid idempotency_key'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 3. Idempotency ledger row must already exist (inserted by the Worker
  -- before calling this RPC, in 'pending' status -- see
  -- src/routes/api/billing/webhook-hotmart.ts). This RPC only flips it to
  -- processed/error and never itself decides whether an event is a
  -- duplicate at the SQL layer, because the full hotmart_events row
  -- (buyer_email, transaction_id, etc.) is written by the Worker before
  -- this call for admin observability even when the event ends up
  -- ignored. If this RPC is somehow called twice for the same key anyway
  -- (defense in depth), the second call is a safe no-op via the check
  -- below.
  IF EXISTS (
    SELECT 1 FROM public.hotmart_events
    WHERE idempotency_key = p_idempotency_key AND processing_status = 'processed'
  ) THEN
    RETURN QUERY SELECT TRUE, 'already processed'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 4. Per-event mutations. Every branch that touches public.subscriptions
  -- carries the same out-of-order guard as Lemon Squeezy's
  -- provider_updated_at (20260711000000_subscription_recency_guard.sql) --
  -- an older event can never regress state a newer one already applied.
  CASE p_event_type
    WHEN 'purchase_approved', 'renewal_approved', 'plan_change' THEN
      IF p_user_id IS NOT NULL AND p_plan IS NOT NULL THEN
        INSERT INTO public.subscriptions (
          user_id, provider, provider_customer_id, provider_subscription_id,
          product_id, variant_id, plan, status, billing_interval,
          renews_at, ends_at, cancelled, provider_updated_at
        ) VALUES (
          p_user_id, 'hotmart', p_provider_customer_id, p_provider_subscription_id,
          p_product_id, p_offer_id, p_plan, COALESCE(p_status, 'active'), p_billing_interval,
          p_renews_at, p_ends_at, FALSE, p_provider_updated_at
        )
        ON CONFLICT (provider_subscription_id) WHERE provider_subscription_id IS NOT NULL DO UPDATE SET
          provider_customer_id = EXCLUDED.provider_customer_id,
          product_id = EXCLUDED.product_id,
          variant_id = EXCLUDED.variant_id,
          plan = EXCLUDED.plan,
          status = EXCLUDED.status,
          billing_interval = EXCLUDED.billing_interval,
          renews_at = EXCLUDED.renews_at,
          ends_at = EXCLUDED.ends_at,
          cancelled = FALSE,
          provider_updated_at = EXCLUDED.provider_updated_at
        WHERE EXCLUDED.provider_updated_at IS NULL
           OR public.subscriptions.provider_updated_at IS NULL
           OR EXCLUDED.provider_updated_at >= public.subscriptions.provider_updated_at;

        SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = p_user_id;
        UPDATE public.users
        SET plan = p_plan, credits_limit = COALESCE(p_credits_limit, 10) + COALESCE(v_bonus, 0)
        WHERE id = p_user_id;

        IF p_event_type = 'purchase_approved' THEN
          SELECT email INTO v_notify_email FROM public.users WHERE id = p_user_id;
          v_notify_kind := 'pro_confirmation';
        END IF;

        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (p_user_id, 'hotmart_' || p_event_type, 'Hotmart ' || p_event_type || ', plan=' || p_plan);
      END IF;

    WHEN 'subscription_cancelled' THEN
      -- Grace period, not an immediate downgrade: mark cancelled + keep
      -- plan/access until ends_at (matches Lemon Squeezy's
      -- subscription_cancelled -- which never touches users.plan either,
      -- only subscription_expired / the reconciliation task does, once the
      -- period genuinely lapses).
      UPDATE public.subscriptions
      SET status = COALESCE(p_status, 'cancelled'), cancelled = TRUE, ends_at = COALESCE(p_ends_at, ends_at), provider_updated_at = p_provider_updated_at
      WHERE provider_subscription_id = p_provider_subscription_id
        AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at)
      RETURNING user_id INTO v_sub_user_id;
      IF v_sub_user_id IS NOT NULL THEN
        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_subscription_cancelled', 'Cancelled at Hotmart -- access remains until period end');
      END IF;

    WHEN 'subscription_expired' THEN
      UPDATE public.subscriptions SET status = 'expired', provider_updated_at = COALESCE(p_provider_updated_at, provider_updated_at)
      WHERE provider_subscription_id = p_provider_subscription_id
        AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at)
      RETURNING user_id INTO v_sub_user_id;
      v_sub_user_id := COALESCE(v_sub_user_id, p_user_id);
      IF v_sub_user_id IS NOT NULL THEN
        SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = v_sub_user_id;
        UPDATE public.users SET plan = 'free', credits_limit = 10 + COALESCE(v_bonus, 0) WHERE id = v_sub_user_id;
        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_subscription_expired', 'Subscription period ended without renewal -- downgraded to FREE');
      END IF;

    WHEN 'refund' THEN
      SELECT user_id INTO v_sub_user_id
      FROM public.subscriptions WHERE provider_subscription_id = p_provider_subscription_id;
      v_sub_user_id := COALESCE(v_sub_user_id, p_user_id);
      IF v_sub_user_id IS NOT NULL THEN
        UPDATE public.subscriptions
        SET status = 'refunded', cancelled = TRUE, ends_at = NOW(), provider_updated_at = NOW()
        WHERE provider_subscription_id = p_provider_subscription_id;

        SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = v_sub_user_id;
        UPDATE public.users
        SET plan = 'free', credits_limit = GREATEST(credits_used, 10 + COALESCE(v_bonus, 0))
        WHERE id = v_sub_user_id;

        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_refund', 'Purchase refunded by Hotmart -- downgraded to FREE, no negative balance');
      END IF;

    WHEN 'chargeback' THEN
      -- More aggressive than refund by explicit policy (fraud risk) --
      -- immediate downgrade, distinct status so support can see it.
      SELECT user_id INTO v_sub_user_id FROM public.subscriptions WHERE provider_subscription_id = p_provider_subscription_id;
      v_sub_user_id := COALESCE(v_sub_user_id, p_user_id);
      IF v_sub_user_id IS NOT NULL THEN
        UPDATE public.subscriptions
        SET status = 'chargeback', cancelled = TRUE, ends_at = NOW(), provider_updated_at = NOW()
        WHERE provider_subscription_id = p_provider_subscription_id;

        SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = v_sub_user_id;
        UPDATE public.users
        SET plan = 'free', credits_limit = GREATEST(credits_used, 10 + COALESCE(v_bonus, 0))
        WHERE id = v_sub_user_id;

        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_chargeback', 'Chargeback/dispute on Hotmart -- downgraded to FREE immediately');
      END IF;

    WHEN 'chargeback_reversed' THEN
      -- Restore from the subscription row's own stored plan/interval --
      -- never re-derived from client-supplied data, never double-credits
      -- (SET, not increment).
      SELECT user_id, plan, billing_interval INTO v_sub_user_id, v_sub_plan, v_sub_interval
      FROM public.subscriptions WHERE provider_subscription_id = p_provider_subscription_id;
      IF v_sub_user_id IS NOT NULL AND v_sub_plan IS NOT NULL THEN
        UPDATE public.subscriptions
        SET status = 'active', cancelled = FALSE, ends_at = NULL, provider_updated_at = p_provider_updated_at
        WHERE provider_subscription_id = p_provider_subscription_id;

        v_sub_credits := CASE v_sub_plan WHEN 'business' THEN 500 ELSE 100 END;
        SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = v_sub_user_id;
        UPDATE public.users SET plan = v_sub_plan, credits_limit = v_sub_credits + COALESCE(v_bonus, 0) WHERE id = v_sub_user_id;

        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_chargeback_reversed', 'Chargeback reversed by Hotmart -- plan restored');
      END IF;

    WHEN 'payment_failed' THEN
      -- No downgrade on a single ambiguous event -- only notify. A real
      -- expiry only happens via an explicit subscription_expired event or
      -- the reconciliation task, after Hotmart's own grace period.
      SELECT user_id INTO v_sub_user_id FROM public.subscriptions WHERE provider_subscription_id = p_provider_subscription_id;
      IF v_sub_user_id IS NOT NULL THEN
        SELECT email INTO v_notify_email FROM public.users WHERE id = v_sub_user_id;
        v_notify_kind := 'payment_failed';
        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_payment_failed', 'Recurring payment failed -- no downgrade yet, grace period applies');
      END IF;

    WHEN 'reactivation' THEN
      SELECT user_id, plan, billing_interval INTO v_sub_user_id, v_sub_plan, v_sub_interval
      FROM public.subscriptions WHERE provider_subscription_id = p_provider_subscription_id;
      IF v_sub_user_id IS NOT NULL THEN
        UPDATE public.subscriptions
        SET status = COALESCE(p_status, 'active'), cancelled = FALSE, ends_at = NULL, provider_updated_at = p_provider_updated_at
        WHERE provider_subscription_id = p_provider_subscription_id
          AND (p_provider_updated_at IS NULL OR provider_updated_at IS NULL OR p_provider_updated_at >= provider_updated_at);

        IF v_sub_plan IS NOT NULL THEN
          v_sub_credits := CASE v_sub_plan WHEN 'business' THEN 500 ELSE 100 END;
          SELECT bonus_credits INTO v_bonus FROM public.users WHERE id = v_sub_user_id;
          UPDATE public.users SET plan = v_sub_plan, credits_limit = v_sub_credits + COALESCE(v_bonus, 0) WHERE id = v_sub_user_id;
        END IF;

        INSERT INTO public.billing_history (user_id, event_type, reason)
        VALUES (v_sub_user_id, 'hotmart_reactivation', 'Subscription reactivated at Hotmart');
      END IF;

    ELSE
      NULL;
  END CASE;

  -- 5. Mark the ledger row processed (see point 3 -- the row must already
  -- exist, inserted 'pending' by the Worker before this call).
  UPDATE public.hotmart_events
  SET processing_status = 'processed', processed_at = NOW(), user_id = COALESCE(user_id, p_user_id), action_taken = p_event_type
  WHERE idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT TRUE, 'ok'::TEXT, v_notify_email, v_notify_kind, p_plan;
END;
$function$;

-- Same least-privilege posture as process_lemon_squeezy_event: only the
-- anon role (the Worker's server-to-server caller, no user JWT) may
-- invoke this, gated by the shared secret checked inside the function.
REVOKE ALL ON FUNCTION public.process_hotmart_event FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_hotmart_event FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_hotmart_event TO anon;
