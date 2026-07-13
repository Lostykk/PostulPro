-- Sets the real BILLING_RPC_SECRET hash for this (preview/new) Supabase
-- project. The 20260709000000_billing_rpc.sql migration shipped a literal
-- placeholder hash that was never replaced out-of-band, so the billing
-- webhook RPC has been rejecting every call as 'unauthorized' since it was
-- created. Only the SHA-256 hex digest is stored here (not reversible in
-- practice for a 256-bit random secret) -- the raw BILLING_RPC_SECRET value
-- itself is set separately as a Cloudflare secret on the preview Worker only
-- and is never written to this repo.
--
-- Guarded by the placeholder check so re-running this file (or applying it
-- to a project where the hash was already rotated for real) is a no-op
-- instead of clobbering a live secret.
UPDATE public.billing_rpc_config
SET secret_hash = '658cc710fa01a437042c76ff0994bb87fa13278fa37c07eab18330aecb9770cb', updated_at = now()
WHERE id = TRUE
  AND secret_hash = 'REPLACE_WITH_SHA256_HEX_OF_BILLING_RPC_SECRET';
