import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of
// supabase/migrations/20260729030000_admin_resolve_hotmart_pending_link.sql
// against pglite — never the shared remote Supabase project. Builds on
// top of the already-written hotmart_events migration, exactly matching
// the real database's eventual migration order.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const EVENTS_MIGRATION = path.join(MIGRATIONS_DIR, "20260729000000_hotmart_events.sql");
const RESOLVE_MIGRATION = path.join(MIGRATIONS_DIR, "20260729030000_admin_resolve_hotmart_pending_link.sql");

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

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL DEFAULT 'test@example.com',
  plan TEXT NOT NULL DEFAULT 'free',
  credits_used INT NOT NULL DEFAULT 0,
  credits_limit INT NOT NULL DEFAULT 10,
  bonus_credits INT NOT NULL DEFAULT 0
);

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'lemon_squeezy',
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  product_id TEXT,
  variant_id TEXT,
  plan TEXT,
  status TEXT,
  billing_interval TEXT,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
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

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const BUYER = "00000000-0000-4000-8000-0000000000b1";

async function setUser(db: PGlite, uid: string | null) {
  await db.exec(`DELETE FROM _test_session;`);
  if (uid) await db.query(`INSERT INTO _test_session (uid) VALUES ($1);`, [uid]);
}

describe("admin_resolve_hotmart_pending_link migration dry-run (local pglite)", () => {
  let db: PGlite;
  let pendingLinkId: string;
  let eventId: string;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(EVENTS_MIGRATION, "utf-8"));
    await db.exec(readFileSync(RESOLVE_MIGRATION, "utf-8"));

    await db.query(`INSERT INTO public.users (id, email, plan) VALUES ($1, 'admin@test.com', 'free'), ($2, 'buyer@test.com', 'free');`, [
      ADMIN,
      BUYER,
    ]);
    await db.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin');`, [ADMIN]);

    const eventRes = await db.query<{ id: string }>(
      `INSERT INTO public.hotmart_events (idempotency_key, event_type) VALUES ('k1', 'purchase_approved') RETURNING id`,
    );
    eventId = eventRes.rows[0].id;

    const linkRes = await db.query<{ id: string }>(
      `INSERT INTO public.hotmart_pending_links (hotmart_event_id, buyer_email, subscription_id, product_id, offer_id)
       VALUES ($1, 'buyer@test.com', 'SUB-1', 'PROD-1', 'OFFER-1') RETURNING id`,
      [eventId],
    );
    pendingLinkId = linkRes.rows[0].id;
  });

  afterEach(async () => {
    await db.close();
  });

  it("rejects a non-admin caller", async () => {
    await setUser(db, BUYER);
    await expect(
      db.query(`SELECT * FROM public.admin_resolve_hotmart_pending_link($1, $2, 'pro', 'month', 100)`, [pendingLinkId, BUYER]),
    ).rejects.toThrow(/Unauthorized/);
  });

  it("an admin resolves the pending link, grants the plan, and links the subscription", async () => {
    await setUser(db, ADMIN);
    const res = await db.query<{ ok: boolean; message: string }>(
      `SELECT * FROM public.admin_resolve_hotmart_pending_link($1, $2, 'pro', 'month', 100)`,
      [pendingLinkId, BUYER],
    );
    expect(res.rows[0]).toEqual({ ok: true, message: "ok" });

    const user = await db.query<{ plan: string; credits_limit: number }>(`SELECT plan, credits_limit FROM public.users WHERE id = $1`, [
      BUYER,
    ]);
    expect(user.rows[0]).toEqual({ plan: "pro", credits_limit: 100 });

    const link = await db.query<{ status: string; resolved_user_id: string }>(
      `SELECT status, resolved_user_id FROM public.hotmart_pending_links WHERE id = $1`,
      [pendingLinkId],
    );
    expect(link.rows[0]).toEqual({ status: "resolved", resolved_user_id: BUYER });

    const sub = await db.query<{ user_id: string; plan: string }>(
      `SELECT user_id, plan FROM public.subscriptions WHERE provider_subscription_id = 'SUB-1'`,
    );
    expect(sub.rows[0]).toEqual({ user_id: BUYER, plan: "pro" });
  });

  it("resolving the same pending link twice is a safe no-op (no double credit grant)", async () => {
    await setUser(db, ADMIN);
    await db.query(`SELECT * FROM public.admin_resolve_hotmart_pending_link($1, $2, 'pro', 'month', 100)`, [pendingLinkId, BUYER]);
    const second = await db.query<{ ok: boolean; message: string }>(
      `SELECT * FROM public.admin_resolve_hotmart_pending_link($1, $2, 'business', 'year', 500)`,
      [pendingLinkId, BUYER],
    );
    expect(second.rows[0]).toEqual({ ok: true, message: "already resolved" });

    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [BUYER]);
    expect(user.rows[0].plan).toBe("pro"); // still the FIRST resolution's plan, not overwritten
  });

  it("rejects an invented plan value", async () => {
    await setUser(db, ADMIN);
    await expect(
      db.query(`SELECT * FROM public.admin_resolve_hotmart_pending_link($1, $2, 'super-ultra-plan', 'month', 999999)`, [
        pendingLinkId,
        BUYER,
      ]),
    ).rejects.toThrow(/Invalid plan/);
  });
});
