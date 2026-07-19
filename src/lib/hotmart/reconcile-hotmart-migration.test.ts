import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of supabase/migrations/20260729040000_reconcile_hotmart_stale.sql
// against pglite — never the shared remote Supabase project.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const EVENTS_MIGRATION = path.join(MIGRATIONS_DIR, "20260729000000_hotmart_events.sql");
const RECONCILE_MIGRATION = path.join(MIGRATIONS_DIR, "20260729040000_reconcile_hotmart_stale.sql");

const STUB_SCHEMA = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',
  credits_used INT NOT NULL DEFAULT 0,
  credits_limit INT NOT NULL DEFAULT 10,
  bonus_credits INT NOT NULL DEFAULT 0
);

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'lemon_squeezy',
  provider_subscription_id TEXT,
  plan TEXT,
  status TEXT,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX subscriptions_provider_subscription_id_key
  ON public.subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE TABLE public.billing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

describe("reconcile_hotmart_stale migration dry-run (local pglite)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(EVENTS_MIGRATION, "utf-8"));
    await db.exec(readFileSync(RECONCILE_MIGRATION, "utf-8"));
    await db.query(`INSERT INTO public.users (id, plan) VALUES ($1, 'pro'), ($2, 'business');`, [USER_A, USER_B]);
  });

  afterEach(async () => {
    await db.close();
  });

  it("downgrades a cancelled subscription whose period has genuinely ended", async () => {
    await db.query(
      `INSERT INTO public.subscriptions (user_id, provider, provider_subscription_id, plan, status, cancelled, ends_at)
       VALUES ($1, 'hotmart', 'SUB-EXPIRED', 'pro', 'cancelled', TRUE, NOW() - INTERVAL '1 day')`,
      [USER_A],
    );

    const res = await db.query<{ expired_subscriptions: number; stuck_events_flagged: number }>(
      `SELECT * FROM public.reconcile_hotmart_stale(200)`,
    );
    expect(res.rows[0].expired_subscriptions).toBe(1);

    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [USER_A]);
    expect(user.rows[0].plan).toBe("free");
    const sub = await db.query<{ status: string }>(`SELECT status FROM public.subscriptions WHERE provider_subscription_id = 'SUB-EXPIRED'`);
    expect(sub.rows[0].status).toBe("expired");
  });

  it("never touches an active (not cancelled) subscription, even one with a past-looking date", async () => {
    await db.query(
      `INSERT INTO public.subscriptions (user_id, provider, provider_subscription_id, plan, status, cancelled, ends_at)
       VALUES ($1, 'hotmart', 'SUB-ACTIVE', 'business', 'active', FALSE, NOW() - INTERVAL '1 day')`,
      [USER_B],
    );
    await db.query(`SELECT * FROM public.reconcile_hotmart_stale(200)`);
    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [USER_B]);
    expect(user.rows[0].plan).toBe("business"); // untouched — never ambiguous-state downgrade
  });

  it("never touches a cancelled subscription still within its paid period", async () => {
    await db.query(
      `INSERT INTO public.subscriptions (user_id, provider, provider_subscription_id, plan, status, cancelled, ends_at)
       VALUES ($1, 'hotmart', 'SUB-GRACE', 'pro', 'cancelled', TRUE, NOW() + INTERVAL '10 days')`,
      [USER_A],
    );
    const res = await db.query<{ expired_subscriptions: number }>(`SELECT * FROM public.reconcile_hotmart_stale(200)`);
    expect(res.rows[0].expired_subscriptions).toBe(0);
    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [USER_A]);
    expect(user.rows[0].plan).toBe("pro");
  });

  it("flags a stuck 'pending' hotmart_events row past the threshold, and leaves a recent one alone", async () => {
    await db.query(
      `INSERT INTO public.hotmart_events (idempotency_key, event_type, processing_status, received_at)
       VALUES ('stuck-1', 'purchase_approved', 'pending', NOW() - INTERVAL '2 hours')`,
    );
    await db.query(
      `INSERT INTO public.hotmart_events (idempotency_key, event_type, processing_status, received_at)
       VALUES ('fresh-1', 'purchase_approved', 'pending', NOW())`,
    );

    const res = await db.query<{ stuck_events_flagged: number }>(`SELECT * FROM public.reconcile_hotmart_stale(200)`);
    expect(res.rows[0].stuck_events_flagged).toBe(1);

    const stuck = await db.query<{ processing_status: string }>(`SELECT processing_status FROM public.hotmart_events WHERE idempotency_key = 'stuck-1'`);
    expect(stuck.rows[0].processing_status).toBe("error");
    const fresh = await db.query<{ processing_status: string }>(`SELECT processing_status FROM public.hotmart_events WHERE idempotency_key = 'fresh-1'`);
    expect(fresh.rows[0].processing_status).toBe("pending");
  });

  it("is idempotent — running it twice in a row does not double-process", async () => {
    await db.query(
      `INSERT INTO public.subscriptions (user_id, provider, provider_subscription_id, plan, status, cancelled, ends_at)
       VALUES ($1, 'hotmart', 'SUB-IDEMPOTENT', 'pro', 'cancelled', TRUE, NOW() - INTERVAL '1 day')`,
      [USER_A],
    );
    const first = await db.query<{ expired_subscriptions: number }>(`SELECT * FROM public.reconcile_hotmart_stale(200)`);
    const second = await db.query<{ expired_subscriptions: number }>(`SELECT * FROM public.reconcile_hotmart_stale(200)`);
    expect(first.rows[0].expired_subscriptions).toBe(1);
    expect(second.rows[0].expired_subscriptions).toBe(0); // already 'expired', not matched again
  });

  it("rejects an out-of-range batch limit", async () => {
    await expect(db.query(`SELECT * FROM public.reconcile_hotmart_stale(0)`)).rejects.toThrow();
    await expect(db.query(`SELECT * FROM public.reconcile_hotmart_stale(10000)`)).rejects.toThrow();
  });

  it("only service_role (not anon, not authenticated, not PUBLIC) may execute", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.routine_privileges WHERE routine_name = 'reconcile_hotmart_stale'`,
    );
    const granted = grants.rows.map((r) => `${r.grantee}:${r.privilege_type}`);
    // The function owner (postgres, in this stub) always implicitly has
    // EXECUTE regardless of explicit grants — that's real Postgres
    // behavior, not a security gap. What matters is that none of the
    // client-reachable roles do.
    expect(granted).toContain("service_role:EXECUTE");
    expect(granted.some((g) => g.startsWith("anon:"))).toBe(false);
    expect(granted.some((g) => g.startsWith("authenticated:"))).toBe(false);
    expect(granted.some((g) => g.startsWith("PUBLIC:"))).toBe(false);
  });
});
