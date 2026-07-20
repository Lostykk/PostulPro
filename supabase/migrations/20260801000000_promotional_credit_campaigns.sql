-- Promotional credit campaigns + grants (launch campaign: 30% Hotmart
-- coupon POSTULPRO30, 10 promotional credits/user, admin-granted).
--
-- Design rationale — see docs/promotional-credits-launch-campaign-report.md
-- §2-3 for the full audit. Short version: PostulPro already has a credit
-- BALANCE mechanism (users.credits_used/credits_limit/bonus_credits) and a
-- credit CONSUMPTION ledger (credit_reservations), but no GRANT ledger —
-- nothing records who received extra credits, why, from which campaign,
-- or by which admin. These two tables are that missing piece, not a
-- second balance: the actual balance increase still flows through the
-- existing bonus_credits column (see the RPC in the next migration),
-- exactly the same mechanism the Lemon Squeezy "Credits-100" top-up
-- already uses and that survives plan changes/renewals/refunds.
--
-- No per-lot expiration: reserve_credits_v2 checks a single pooled
-- credits_used/credits_limit, with no concept of "which lot of credits is
-- being spent". A promotional_credit_grants.expires_at that nothing ever
-- enforces would be a fake control, not a real one — so this column
-- exists (for a future refactor) but the RPC in the next migration never
-- sets it. Documented, not simulated.

CREATE TABLE public.promotional_credit_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_name TEXT NOT NULL UNIQUE CHECK (length(trim(internal_name)) > 0),
  public_name TEXT NOT NULL CHECK (length(trim(public_name)) > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'closed')),
  credits_per_user INT NOT NULL CHECK (credits_per_user > 0),
  maximum_recipients INT NOT NULL CHECK (maximum_recipients > 0),
  -- Maintained exclusively by admin_grant_promotional_credits /
  -- admin_revoke_promotional_credit_grant (next migrations) inside the
  -- same transaction as the grant/revoke itself — never written directly
  -- by client code, so it can never drift from the real grant count.
  grants_count INT NOT NULL DEFAULT 0 CHECK (grants_count >= 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  -- Reserved for a future per-lot consumption refactor — never read or
  -- enforced by any RPC in this migration set. See header comment.
  expires_after_days INT CHECK (expires_after_days IS NULL OR expires_after_days > 0),
  coupon_code TEXT,
  hotmart_product_id TEXT,
  allowed_plan_ids TEXT[] NOT NULL DEFAULT ARRAY['free', 'pro', 'business'],
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotional_credit_campaigns_grants_within_max CHECK (grants_count <= maximum_recipients),
  CONSTRAINT promotional_credit_campaigns_dates_ordered CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at)
);
CREATE INDEX promotional_credit_campaigns_status_idx ON public.promotional_credit_campaigns (status);

ALTER TABLE public.promotional_credit_campaigns ENABLE ROW LEVEL SECURITY;
-- Same Cloudflare-default-grant gotcha documented in
-- 20260727000000_credit_reservations_idempotent_refund.sql — REVOKE ALL
-- first, then grant back exactly what's needed.
REVOKE ALL ON public.promotional_credit_campaigns FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.promotional_credit_campaigns TO service_role;
GRANT SELECT ON public.promotional_credit_campaigns TO authenticated;
-- Admin-only read: campaign internals (max recipients, coupon code,
-- Hotmart product id) are not something a regular user should be able to
-- enumerate. All mutation goes through SECURITY DEFINER RPCs (next
-- migrations), which bypass RLS entirely as the function owner — this
-- table has no INSERT/UPDATE/DELETE policy for authenticated at all.
CREATE POLICY "Admin read campaigns" ON public.promotional_credit_campaigns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.promotional_credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.promotional_credit_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credits_granted INT NOT NULL CHECK (credits_granted > 0),
  reason TEXT,
  -- Deterministic, computed server-side by the grant RPC (sha256 of
  -- campaign_id:user_id) — not caller-supplied. The real double-grant
  -- guard is the UNIQUE(campaign_id, user_id) constraint below; this
  -- column exists so every grant carries an explicit, auditable
  -- idempotency key value (as required), not just an implicit one.
  idempotency_key TEXT NOT NULL UNIQUE,
  granted_by UUID NOT NULL REFERENCES public.users(id),
  hotmart_reference TEXT,
  -- 'fully_consumed' and 'expired' are part of the CHECK for forward
  -- compatibility with a future per-lot consumption system, but nothing
  -- in this migration set ever transitions a grant to either — this
  -- system cannot know how much of a specific grant's credits remain
  -- (single pooled balance, see header comment). Only 'active' and
  -- 'revoked' are ever written by the RPCs here.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fully_consumed', 'expired', 'revoked', 'reversed')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ, -- reserved, never set — see header comment
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  revoked_reason TEXT,
  reversal_ledger_entry_id UUID REFERENCES public.billing_history(id) ON DELETE SET NULL,
  credits_reverted INT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The hard double-grant guard: one active-or-otherwise grant row per
  -- (campaign, user), enforced by Postgres itself, not just by
  -- application logic racing a SELECT-then-INSERT.
  CONSTRAINT promotional_credit_grants_one_per_user_per_campaign UNIQUE (campaign_id, user_id),
  CONSTRAINT promotional_credit_grants_revoked_shape
    CHECK (status <> 'revoked' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX promotional_credit_grants_user_id_idx ON public.promotional_credit_grants (user_id);
CREATE INDEX promotional_credit_grants_campaign_id_idx ON public.promotional_credit_grants (campaign_id);
CREATE INDEX promotional_credit_grants_idempotency_key_idx ON public.promotional_credit_grants (idempotency_key);

ALTER TABLE public.promotional_credit_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotional_credit_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.promotional_credit_grants TO service_role;
GRANT SELECT ON public.promotional_credit_grants TO authenticated;
-- A user may see their own grants (transparency — "you received 10
-- promotional credits from campaign X"); an admin sees all, for the
-- Admin → Créditos promocionales history view.
CREATE POLICY "Own or admin read promotional grants" ON public.promotional_credit_grants FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
