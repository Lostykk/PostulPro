-- Generic persistent rate limiter for unauthenticated server-to-server
-- endpoints (the Hotmart webhook first; reusable by any future one).
--
-- Not the same table/RPC as plan_rate_limit_events/claim_plan_rate_limit
-- (20260714010000_plan_rate_limiting.sql) -- that one is keyed by
-- auth.uid(), which a webhook call has no access to (there is no user JWT
-- on an inbound Hotmart request). This is keyed by an arbitrary
-- caller-supplied string (the Worker passes hashIp(request) from
-- src/lib/rate-limit.server.ts, reused unchanged) and, because there is no
-- auth.uid() to authenticate the caller, is itself gated by the same
-- BILLING_RPC_SECRET every other billing RPC uses -- an untrusted caller
-- without the secret cannot consume or manipulate anyone's rate-limit
-- bucket.

CREATE TABLE public.webhook_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX webhook_rate_limit_events_key_created_idx ON public.webhook_rate_limit_events (rate_key, created_at DESC);
CREATE INDEX webhook_rate_limit_events_created_idx ON public.webhook_rate_limit_events (created_at);

ALTER TABLE public.webhook_rate_limit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.webhook_rate_limit_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_webhook_rate_limit(
  p_secret TEXT,
  p_rate_key TEXT,
  p_window_seconds INT,
  p_max_requests INT
)
RETURNS TABLE(allowed BOOLEAN, remaining INT, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_stored_hash TEXT;
  v_window_count INT;
  v_oldest_in_window TIMESTAMPTZ;
BEGIN
  SELECT secret_hash INTO v_stored_hash FROM public.billing_rpc_config WHERE id = TRUE;
  IF p_secret IS NULL OR v_stored_hash IS NULL OR encode(extensions.digest(p_secret, 'sha256'), 'hex') <> v_stored_hash THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_rate_key IS NULL OR length(p_rate_key) = 0 THEN
    RAISE EXCEPTION 'Invalid rate_key';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_max_requests IS NULL OR p_max_requests <= 0 THEN
    RAISE EXCEPTION 'Invalid rate limit configuration';
  END IF;

  -- Serialize concurrent claims for this same key only.
  PERFORM pg_advisory_xact_lock(hashtext(p_rate_key));

  SELECT count(*), min(created_at) INTO v_window_count, v_oldest_in_window
  FROM public.webhook_rate_limit_events
  WHERE rate_key = p_rate_key AND created_at > NOW() - make_interval(secs => p_window_seconds);

  IF v_window_count >= p_max_requests THEN
    RETURN QUERY SELECT FALSE, 0, COALESCE(v_oldest_in_window, NOW()) + make_interval(secs => p_window_seconds);
    RETURN;
  END IF;

  INSERT INTO public.webhook_rate_limit_events (rate_key) VALUES (p_rate_key);

  RETURN QUERY SELECT TRUE, GREATEST(0, p_max_requests - v_window_count - 1), NOW() + make_interval(secs => p_window_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_rate_limit FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_webhook_rate_limit FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_rate_limit TO anon;
