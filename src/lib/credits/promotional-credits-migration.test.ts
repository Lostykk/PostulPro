import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of the promotional-credits migrations against a real
// (WASM) Postgres engine — never the shared remote Supabase project. See
// docs/promotional-credits-launch-campaign-report.md for the full design
// rationale. Follows the same stub-schema convention as every other
// migration dry-run test in this repo (e.g.
// src/lib/hotmart/admin-resolve-pending-link-migration.test.ts): a
// `_test_session` table stands in for a JWT's auth.uid(), and RLS policy
// TEXT is trusted as the enforcement boundary (not independently
// simulated via SET ROLE) — same posture as every other admin-only table
// here.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const CAMPAIGNS_MIGRATION = path.join(MIGRATIONS_DIR, "20260801000000_promotional_credit_campaigns.sql");
const GRANT_RPC_MIGRATION = path.join(MIGRATIONS_DIR, "20260801010000_admin_grant_promotional_credits_rpc.sql");
const REVOKE_RPC_MIGRATION = path.join(MIGRATIONS_DIR, "20260801020000_admin_revoke_promotional_credit_grant_rpc.sql");
const TOGGLE_RPC_MIGRATION = path.join(MIGRATIONS_DIR, "20260801030000_admin_toggle_promotional_campaign_rpc.sql");
const SEED_MIGRATION = path.join(MIGRATIONS_DIR, "20260801040000_seed_postulpro_launch_2026_campaign.sql");

const STUB_SCHEMA = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE _test_session (uid UUID);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT uid FROM _test_session LIMIT 1;
$$;

CREATE TABLE public.user_roles (user_id UUID NOT NULL, role TEXT NOT NULL);
CREATE FUNCTION public.has_role(p_uid UUID, p_role TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = p_uid AND role = p_role);
$$;

-- PGlite has no pgcrypto extension (verified empirically elsewhere in this
-- repo — see hotmart-events-migration.test.ts's own comment). Stub
-- extensions.digest as a thin wrapper over PGlite's real core sha256().
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE FUNCTION extensions.digest(data TEXT, algo TEXT) RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(data::bytea) $$;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL DEFAULT 'test@example.com',
  plan TEXT NOT NULL DEFAULT 'free',
  credits_used INT NOT NULL DEFAULT 0,
  credits_limit INT NOT NULL DEFAULT 10,
  bonus_credits INT NOT NULL DEFAULT 0
);

CREATE TABLE public.billing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const ADMIN = "00000000-0000-4000-8000-0000000000a0";
const NORMAL_USER = "00000000-0000-4000-8000-0000000000e0";
const RECIPIENT_A = "00000000-0000-4000-8000-0000000000a1";
const RECIPIENT_B = "00000000-0000-4000-8000-0000000000b1";

async function setSession(db: PGlite, uid: string | null) {
  await db.exec(`DELETE FROM _test_session;`);
  if (uid) await db.query(`INSERT INTO _test_session (uid) VALUES ($1);`, [uid]);
}

type GrantRow = {
  ok: boolean;
  message: string;
  grant_id: string | null;
  credits_granted: number | null;
  new_bonus_credits: number | null;
  new_credits_limit: number | null;
};

async function callGrant(
  db: PGlite,
  campaignId: string,
  targetUserId: string,
  opts: { reason?: string; hotmartReference?: string } = {},
): Promise<GrantRow> {
  const res = await db.query<GrantRow>(
    `SELECT * FROM public.admin_grant_promotional_credits($1, $2, $3, $4)`,
    [campaignId, targetUserId, opts.reason ?? null, opts.hotmartReference ?? null],
  );
  return res.rows[0];
}

type RevokeRow = {
  ok: boolean;
  message: string;
  credits_reverted: number | null;
  was_partially_consumed: boolean | null;
  new_bonus_credits: number | null;
  new_credits_limit: number | null;
};

async function callRevoke(db: PGlite, grantId: string, reason: string, confirmPartial = false): Promise<RevokeRow> {
  const res = await db.query<RevokeRow>(
    `SELECT * FROM public.admin_revoke_promotional_credit_grant($1, $2, $3)`,
    [grantId, reason, confirmPartial],
  );
  return res.rows[0];
}

describe("promotional credits migrations dry-run (local pglite, never the shared remote project)", () => {
  let db: PGlite;
  let campaignId: string;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(CAMPAIGNS_MIGRATION, "utf-8"));
    await db.exec(readFileSync(GRANT_RPC_MIGRATION, "utf-8"));
    await db.exec(readFileSync(REVOKE_RPC_MIGRATION, "utf-8"));
    await db.exec(readFileSync(TOGGLE_RPC_MIGRATION, "utf-8"));
    await db.exec(readFileSync(SEED_MIGRATION, "utf-8"));

    await db.query(
      `INSERT INTO public.users (id, email, plan, credits_used, credits_limit, bonus_credits) VALUES
       ($1, 'admin@test.com', 'free', 0, 10, 0),
       ($2, 'normal@test.com', 'free', 0, 10, 0),
       ($3, 'recipient-a@test.com', 'pro', 3, 100, 0),
       ($4, 'recipient-b@test.com', 'free', 0, 10, 0)`,
      [ADMIN, NORMAL_USER, RECIPIENT_A, RECIPIENT_B],
    );
    await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin');`, [ADMIN]);

    const campaignRes = await db.query<{ id: string }>(
      `SELECT id FROM public.promotional_credit_campaigns WHERE internal_name = 'postulpro_launch_2026'`,
    );
    campaignId = campaignRes.rows[0].id;
    // Activate for the tests below — seeded as 'draft' by design (an
    // admin must explicitly turn it on), so tests exercising the "happy
    // path" activate it first via the same RPC an admin would use.
    await setSession(db, ADMIN);
    await db.query(`SELECT * FROM public.admin_set_promotional_campaign_status($1, 'active')`, [campaignId]);
  });

  afterEach(async () => {
    await db.close();
  });

  it("both migrations + seed apply cleanly", async () => {
    const row = await db.query<{ internal_name: string; credits_per_user: number; maximum_recipients: number; coupon_code: string; status: string }>(
      `SELECT internal_name, credits_per_user, maximum_recipients, coupon_code, status FROM public.promotional_credit_campaigns WHERE id = $1`,
      [campaignId],
    );
    expect(row.rows[0]).toEqual(
      expect.objectContaining({ internal_name: "postulpro_launch_2026", credits_per_user: 10, maximum_recipients: 25, coupon_code: "POSTULPRO30" }),
    );
  });

  it("re-running the seed migration never creates a duplicate campaign", async () => {
    await db.exec(readFileSync(SEED_MIGRATION, "utf-8"));
    const count = await db.query<{ count: string }>(
      `SELECT count(*)::text FROM public.promotional_credit_campaigns WHERE internal_name = 'postulpro_launch_2026'`,
    );
    expect(count.rows[0].count).toBe("1");
  });

  describe("admin_grant_promotional_credits", () => {
    it("rejects a non-admin caller", async () => {
      await setSession(db, NORMAL_USER);
      await expect(callGrant(db, campaignId, RECIPIENT_A)).rejects.toThrow(/Unauthorized/);
    });

    it("rejects an unauthenticated caller", async () => {
      await setSession(db, null);
      await expect(callGrant(db, campaignId, RECIPIENT_A)).rejects.toThrow(/Unauthorized/);
    });

    it("rejects a nonexistent campaign", async () => {
      await setSession(db, ADMIN);
      await expect(callGrant(db, "00000000-0000-4000-8000-0000000000ff", RECIPIENT_A)).rejects.toThrow(/Campaign not found/);
    });

    it("rejects a nonexistent target user", async () => {
      await setSession(db, ADMIN);
      await expect(callGrant(db, campaignId, "00000000-0000-4000-8000-0000000000ff")).rejects.toThrow(/Target user not found/);
    });

    it("refuses to grant on a draft (inactive) campaign", async () => {
      const draftCampaign = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients)
         VALUES ('draft_test', 'Draft', 5, 10) RETURNING id`,
      );
      await setSession(db, ADMIN);
      const result = await callGrant(db, draftCampaign.rows[0].id, RECIPIENT_A);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not active/);
    });

    it("refuses to grant on a campaign that hasn't started yet", async () => {
      const future = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients, status, starts_at)
         VALUES ('future_test', 'Future', 5, 10, 'active', NOW() + INTERVAL '1 day') RETURNING id`,
      );
      await setSession(db, ADMIN);
      const result = await callGrant(db, future.rows[0].id, RECIPIENT_A);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not started/);
    });

    it("refuses to grant on an expired campaign", async () => {
      const expired = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients, status, ends_at)
         VALUES ('expired_test', 'Expired', 5, 10, 'active', NOW() - INTERVAL '1 day') RETURNING id`,
      );
      await setSession(db, ADMIN);
      const result = await callGrant(db, expired.rows[0].id, RECIPIENT_A);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/already ended/);
    });

    it("grants correctly: updates bonus_credits, credits_limit, and writes billing_history", async () => {
      await setSession(db, ADMIN);
      const result = await callGrant(db, campaignId, RECIPIENT_A, { reason: "QA test grant" });
      expect(result.ok).toBe(true);
      expect(result.credits_granted).toBe(10);
      expect(result.new_bonus_credits).toBe(10);
      expect(result.new_credits_limit).toBe(110); // 100 base + 10 promo

      const user = await db.query<{ bonus_credits: number; credits_limit: number }>(
        `SELECT bonus_credits, credits_limit FROM public.users WHERE id = $1`,
        [RECIPIENT_A],
      );
      expect(user.rows[0]).toEqual({ bonus_credits: 10, credits_limit: 110 });

      const ledger = await db.query<{ event_type: string; reason: string }>(
        `SELECT event_type, reason FROM public.billing_history WHERE user_id = $1`,
        [RECIPIENT_A],
      );
      expect(ledger.rows).toHaveLength(1);
      expect(ledger.rows[0].event_type).toBe("promotional_credit_grant");
      expect(ledger.rows[0].reason).toContain("postulpro_launch_2026");

      const grant = await db.query<{ status: string; idempotency_key: string; granted_by: string }>(
        `SELECT status, idempotency_key, granted_by FROM public.promotional_credit_grants WHERE id = $1`,
        [result.grant_id],
      );
      expect(grant.rows[0].status).toBe("active");
      expect(grant.rows[0].granted_by).toBe(ADMIN);
      expect(grant.rows[0].idempotency_key).toMatch(/^promo:[a-f0-9]{32}$/);

      const campaign = await db.query<{ grants_count: number }>(
        `SELECT grants_count FROM public.promotional_credit_campaigns WHERE id = $1`,
        [campaignId],
      );
      expect(campaign.rows[0].grants_count).toBe(1);
    });

    it("double-click / retry is idempotent — never a second grant, never double credits", async () => {
      await setSession(db, ADMIN);
      const first = await callGrant(db, campaignId, RECIPIENT_A);
      const second = await callGrant(db, campaignId, RECIPIENT_A);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.message).toMatch(/already granted/);
      expect(second.grant_id).toBe(first.grant_id);

      const user = await db.query<{ bonus_credits: number }>(`SELECT bonus_credits FROM public.users WHERE id = $1`, [RECIPIENT_A]);
      expect(user.rows[0].bonus_credits).toBe(10); // not 20

      const grantCount = await db.query<{ count: string }>(
        `SELECT count(*)::text FROM public.promotional_credit_grants WHERE campaign_id = $1 AND user_id = $2`,
        [campaignId, RECIPIENT_A],
      );
      expect(grantCount.rows[0].count).toBe("1");

      const campaign = await db.query<{ grants_count: number }>(
        `SELECT grants_count FROM public.promotional_credit_campaigns WHERE id = $1`,
        [campaignId],
      );
      expect(campaign.rows[0].grants_count).toBe(1); // counted once, not twice
    });

    it("the UNIQUE(campaign_id, user_id) constraint holds even bypassing the RPC", async () => {
      await setSession(db, ADMIN);
      await callGrant(db, campaignId, RECIPIENT_A);
      await expect(
        db.query(
          `INSERT INTO public.promotional_credit_grants (campaign_id, user_id, credits_granted, idempotency_key, granted_by)
           VALUES ($1, $2, 10, 'manual-bypass-key', $3)`,
          [campaignId, RECIPIENT_A, ADMIN],
        ),
      ).rejects.toThrow();
    });

    it("enforces the maximum_recipients cap — the 26th distinct grant on a 25-max campaign is rejected", async () => {
      const capped = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients, status)
         VALUES ('capped_test', 'Capped', 1, 2, 'active') RETURNING id`,
      );
      const capId = capped.rows[0].id;
      await setSession(db, ADMIN);

      // Two more real users beyond RECIPIENT_A/B to fill a 2-max campaign
      // and then attempt a 3rd distinct recipient.
      const extra = await db.query<{ id: string }>(`INSERT INTO public.users (id) VALUES (gen_random_uuid()) RETURNING id`);
      const extraId = extra.rows[0].id;

      const r1 = await callGrant(db, capId, RECIPIENT_A);
      const r2 = await callGrant(db, capId, RECIPIENT_B);
      const r3 = await callGrant(db, capId, extraId);

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(false);
      expect(r3.message).toMatch(/maximum recipients/);

      const campaign = await db.query<{ grants_count: number }>(
        `SELECT grants_count FROM public.promotional_credit_campaigns WHERE id = $1`,
        [capId],
      );
      expect(campaign.rows[0].grants_count).toBe(2); // never 3
    });

    it("sequential grant attempts against a shared counter never exceed the cap (FOR UPDATE serialization proxy for concurrency)", async () => {
      const capped = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients, status)
         VALUES ('race_test', 'Race', 1, 1, 'active') RETURNING id`,
      );
      const capId = capped.rows[0].id;
      await setSession(db, ADMIN);

      const results = await Promise.all([callGrant(db, capId, RECIPIENT_A), callGrant(db, capId, RECIPIENT_B)]);
      const succeeded = results.filter((r) => r.ok && r.message === "granted");
      const rejected = results.filter((r) => !r.ok);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const campaign = await db.query<{ grants_count: number }>(`SELECT grants_count FROM public.promotional_credit_campaigns WHERE id = $1`, [capId]);
      expect(campaign.rows[0].grants_count).toBe(1);
    });

    it("rejects a target user whose plan is not in allowed_plan_ids", async () => {
      const restricted = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients, status, allowed_plan_ids)
         VALUES ('restricted_test', 'Restricted', 5, 10, 'active', ARRAY['business']) RETURNING id`,
      );
      await setSession(db, ADMIN);
      const result = await callGrant(db, restricted.rows[0].id, RECIPIENT_B); // RECIPIENT_B is 'free'
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not eligible/);
    });
  });

  describe("admin_revoke_promotional_credit_grant", () => {
    it("rejects a non-admin caller", async () => {
      await setSession(db, ADMIN);
      const grant = await callGrant(db, campaignId, RECIPIENT_A);
      await setSession(db, NORMAL_USER);
      await expect(callRevoke(db, grant.grant_id!, "test")).rejects.toThrow(/Unauthorized/);
    });

    it("reverts a fully-available grant cleanly, floors credits_limit at credits_used, and writes a compensatory ledger entry", async () => {
      await setSession(db, ADMIN);
      const grant = await callGrant(db, campaignId, RECIPIENT_A);
      const revoke = await callRevoke(db, grant.grant_id!, "granted to the wrong user");

      expect(revoke.ok).toBe(true);
      expect(revoke.credits_reverted).toBe(10);
      expect(revoke.was_partially_consumed).toBe(false);
      expect(revoke.new_bonus_credits).toBe(0);
      expect(revoke.new_credits_limit).toBe(100); // back to the original base

      const grantRow = await db.query<{ status: string; revoked_by: string; credits_reverted: number }>(
        `SELECT status, revoked_by, credits_reverted FROM public.promotional_credit_grants WHERE id = $1`,
        [grant.grant_id],
      );
      expect(grantRow.rows[0]).toEqual({ status: "revoked", revoked_by: ADMIN, credits_reverted: 10 });

      const ledger = await db.query<{ count: string }>(
        `SELECT count(*)::text FROM public.billing_history WHERE user_id = $1 AND event_type = 'promotional_credit_grant_revoked'`,
        [RECIPIENT_A],
      );
      expect(ledger.rows[0].count).toBe("1");
    });

    it("double revocation is idempotent — never a second compensatory entry", async () => {
      await setSession(db, ADMIN);
      const grant = await callGrant(db, campaignId, RECIPIENT_A);
      const first = await callRevoke(db, grant.grant_id!, "mistake");
      const second = await callRevoke(db, grant.grant_id!, "mistake again");

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
      expect(second.message).toMatch(/not active/);

      const user = await db.query<{ bonus_credits: number }>(`SELECT bonus_credits FROM public.users WHERE id = $1`, [RECIPIENT_A]);
      expect(user.rows[0].bonus_credits).toBe(0); // not negative, not double-reverted
    });

    it("refuses to revert into plan credits without explicit confirmation when the bonus pool is already short", async () => {
      await setSession(db, ADMIN);
      const grant = await callGrant(db, campaignId, RECIPIENT_A);
      // Simulate the bonus pool having been drawn down by something else
      // (e.g. spent on generations) to below the granted amount.
      await db.query(`UPDATE public.users SET bonus_credits = 3 WHERE id = $1`, [RECIPIENT_A]);

      const refused = await callRevoke(db, grant.grant_id!, "test");
      expect(refused.ok).toBe(false);
      expect(refused.was_partially_consumed).toBe(true);
      expect(refused.message).toMatch(/p_confirm_partial_consumption/);

      const userAfterRefusal = await db.query<{ bonus_credits: number }>(`SELECT bonus_credits FROM public.users WHERE id = $1`, [RECIPIENT_A]);
      expect(userAfterRefusal.rows[0].bonus_credits).toBe(3); // untouched

      const confirmed = await callRevoke(db, grant.grant_id!, "test", true);
      expect(confirmed.ok).toBe(true);
      expect(confirmed.credits_reverted).toBe(3); // only what was recoverable
      expect(confirmed.was_partially_consumed).toBe(true);

      const userAfterConfirm = await db.query<{ bonus_credits: number }>(`SELECT bonus_credits FROM public.users WHERE id = $1`, [RECIPIENT_A]);
      expect(userAfterConfirm.rows[0].bonus_credits).toBe(0); // floored, never negative
    });

    it("revoking a grant never frees up a campaign slot for a new recipient beyond the original max", async () => {
      const capped = await db.query<{ id: string }>(
        `INSERT INTO public.promotional_credit_campaigns (internal_name, public_name, credits_per_user, maximum_recipients, status)
         VALUES ('revoke_cap_test', 'RevokeCap', 1, 1, 'active') RETURNING id`,
      );
      const capId = capped.rows[0].id;
      await setSession(db, ADMIN);

      const grant = await callGrant(db, capId, RECIPIENT_A);
      await callRevoke(db, grant.grant_id!, "wrong recipient");

      const secondAttempt = await callGrant(db, capId, RECIPIENT_B);
      expect(secondAttempt.ok).toBe(false);
      expect(secondAttempt.message).toMatch(/maximum recipients/);
    });
  });

  describe("admin_set_promotional_campaign_status", () => {
    it("rejects a non-admin caller", async () => {
      await setSession(db, NORMAL_USER);
      await expect(db.query(`SELECT * FROM public.admin_set_promotional_campaign_status($1, 'paused')`, [campaignId])).rejects.toThrow(/Unauthorized/);
    });

    it("lets an admin pause and reactivate the campaign", async () => {
      await setSession(db, ADMIN);
      const paused = await db.query<{ status: string }>(`SELECT status FROM public.admin_set_promotional_campaign_status($1, 'paused')`, [campaignId]);
      expect(paused.rows[0].status).toBe("paused");

      const grantWhilePaused = await callGrant(db, campaignId, RECIPIENT_A);
      expect(grantWhilePaused.ok).toBe(false);

      await db.query(`SELECT * FROM public.admin_set_promotional_campaign_status($1, 'active')`, [campaignId]);
      const grantAfterReactivation = await callGrant(db, campaignId, RECIPIENT_A);
      expect(grantAfterReactivation.ok).toBe(true);
    });

    it("rejects an invalid status value", async () => {
      await setSession(db, ADMIN);
      await expect(db.query(`SELECT * FROM public.admin_set_promotional_campaign_status($1, 'made_up_status')`, [campaignId])).rejects.toThrow(/Invalid status/);
    });
  });

  describe("RLS grants (structural — same convention as admin-read-access-migration.test.ts)", () => {
    it("only service_role and authenticated have any privilege on the new tables; anon has none", async () => {
      const grants = await db.query<{ grantee: string; table_name: string; privilege_type: string }>(
        `SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
         WHERE table_name IN ('promotional_credit_campaigns', 'promotional_credit_grants')`,
      );
      const anonGrants = grants.rows.filter((g) => g.grantee === "anon");
      expect(anonGrants).toHaveLength(0);
      const authenticatedPrivileges = grants.rows.filter((g) => g.grantee === "authenticated").map((g) => g.privilege_type);
      expect(authenticatedPrivileges).toHaveLength(2); // one SELECT per table, never more
      expect(authenticatedPrivileges.every((p) => p === "SELECT")).toBe(true); // never INSERT/UPDATE/DELETE directly
    });

    it("RPCs are executable by authenticated, never by anon/PUBLIC", async () => {
      const grants = await db.query<{ grantee: string; routine_name: string }>(
        `SELECT grantee, routine_name FROM information_schema.routine_privileges
         WHERE routine_name IN ('admin_grant_promotional_credits', 'admin_revoke_promotional_credit_grant', 'admin_set_promotional_campaign_status')`,
      );
      const byRoutine = new Map<string, string[]>();
      for (const g of grants.rows) byRoutine.set(g.routine_name, [...(byRoutine.get(g.routine_name) ?? []), g.grantee]);
      for (const routine of ["admin_grant_promotional_credits", "admin_revoke_promotional_credit_grant", "admin_set_promotional_campaign_status"]) {
        const grantees = byRoutine.get(routine) ?? [];
        expect(grantees, routine).toContain("authenticated");
        expect(grantees, routine).not.toContain("anon");
        expect(grantees, routine).not.toContain("PUBLIC");
      }
    });
  });
});
