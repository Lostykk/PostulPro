-- Idempotency ledger for app-triggered transactional emails (welcome,
-- low-credits, weekly-summary). Keyed by a stable, PII-free identifier
-- (e.g. "welcome/<user_id>") so retries, duplicate client requests, or a
-- Worker restart mid-send can never result in the same notification being
-- sent twice. Never queried directly by clients — reachable only through
-- claim_notification(), an atomic "insert or tell me it already existed"
-- primitive.

CREATE TABLE public.sent_notifications (
  idempotency_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sent_notifications_user_kind ON public.sent_notifications(user_id, kind);

ALTER TABLE public.sent_notifications ENABLE ROW LEVEL SECURITY;
-- No policies granted: this table has zero direct client access, by design.
-- All access goes through the SECURITY DEFINER RPC below.
REVOKE ALL ON public.sent_notifications FROM anon, authenticated;

-- Atomically claims a notification slot for the calling user. Returns true
-- if this call is the one that gets to send (row inserted), false if some
-- earlier call already claimed it (row already existed) — the caller must
-- treat false as "already sent, do not send again", not as an error.
-- Always keys off auth.uid(), never a client-supplied user id, so a caller
-- can only ever claim notifications for themselves.
CREATE OR REPLACE FUNCTION public.claim_notification(p_key TEXT, p_kind TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_key IS NULL OR length(p_key) = 0 THEN
    RAISE EXCEPTION 'Invalid key';
  END IF;

  INSERT INTO public.sent_notifications (idempotency_key, user_id, kind)
  VALUES (p_key, v_uid, p_kind)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notification(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_notification(TEXT, TEXT) TO authenticated;
