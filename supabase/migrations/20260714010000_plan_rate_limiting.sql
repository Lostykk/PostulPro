-- Persistent, server-side rate limiting for AI project plan generation
-- (POST /api/projects/:id/plan). Not memory/instance-local — Workers are
-- ephemeral and multi-instance, so an in-process counter would let every
-- new isolate reset the limit. This uses Postgres as the shared,
-- consistent counter instead.
--
-- Design: an append-only event log (one row per ALLOWED request) plus a
-- SECURITY DEFINER RPC that atomically checks + records in one
-- transaction. auth.uid() is the authoritative identity — the client
-- cannot claim to be a different user. IP is never stored in plaintext;
-- the caller passes an already-HMAC-hashed value (see
-- src/lib/rate-limit.server.ts) purely as a complementary signal, never
-- the primary key. The table itself grants nothing to anon/authenticated
-- — the only way to read or write it is through the RPC below, which
-- runs as the table owner.

CREATE TABLE public.plan_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX plan_rate_limit_events_user_created_idx ON public.plan_rate_limit_events (user_id, created_at DESC);
CREATE INDEX plan_rate_limit_events_created_idx ON public.plan_rate_limit_events (created_at);

ALTER TABLE public.plan_rate_limit_events ENABLE ROW LEVEL SECURITY;
-- Deliberately zero policies: default-deny for every client role. Only
-- the SECURITY DEFINER RPC (which bypasses RLS as the table owner) ever
-- touches this table.
REVOKE ALL ON public.plan_rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.plan_rate_limit_events TO service_role;

-- Atomically checks the caller's burst-window and daily counts and, only
-- if both are under their limits, records this attempt — all inside one
-- transaction serialized per-user via an advisory lock, so two
-- concurrent requests from the same user can't both read "3 of 5 used"
-- and both proceed, pushing the real count to 5 instead of capping at 5.
CREATE OR REPLACE FUNCTION public.claim_plan_rate_limit(
  p_ip_hash TEXT,
  p_window_seconds INT,
  p_max_requests INT,
  p_daily_max INT
)
RETURNS TABLE(allowed BOOLEAN, remaining INT, reset_at TIMESTAMPTZ, daily_remaining INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_window_count INT;
  v_daily_count INT;
  v_oldest_in_window TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds <= 0
     OR p_max_requests IS NULL OR p_max_requests <= 0
     OR p_daily_max IS NULL OR p_daily_max <= 0 THEN
    RAISE EXCEPTION 'Invalid rate limit configuration';
  END IF;

  -- Serialize concurrent calls for this same user only — other users'
  -- requests are never blocked by this lock.
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text));

  SELECT count(*), min(created_at) INTO v_window_count, v_oldest_in_window
  FROM public.plan_rate_limit_events
  WHERE user_id = v_uid AND created_at > NOW() - make_interval(secs => p_window_seconds);

  SELECT count(*) INTO v_daily_count
  FROM public.plan_rate_limit_events
  WHERE user_id = v_uid AND created_at > NOW() - interval '24 hours';

  IF v_window_count >= p_max_requests OR v_daily_count >= p_daily_max THEN
    RETURN QUERY SELECT
      FALSE,
      GREATEST(0, p_max_requests - v_window_count),
      COALESCE(v_oldest_in_window, NOW()) + make_interval(secs => p_window_seconds),
      GREATEST(0, p_daily_max - v_daily_count);
    RETURN;
  END IF;

  INSERT INTO public.plan_rate_limit_events (user_id, ip_hash) VALUES (v_uid, p_ip_hash);

  RETURN QUERY SELECT
    TRUE,
    GREATEST(0, p_max_requests - v_window_count - 1),
    NOW() + make_interval(secs => p_window_seconds),
    GREATEST(0, p_daily_max - v_daily_count - 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_plan_rate_limit(TEXT, INT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_plan_rate_limit(TEXT, INT, INT, INT) TO authenticated;
