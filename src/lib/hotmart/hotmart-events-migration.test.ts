import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of the two new Hotmart migrations against a real
// (WASM, in-memory) Postgres engine — NEVER the shared remote Supabase
// project. Neither migration has been applied there; this is the "dry-run"
// evidence requested before authorization to actually apply them.
//
// PGlite has no pgcrypto extension (verified empirically — CREATE EXTENSION
// pgcrypto fails), so `extensions.digest(text, text)` is stubbed here as a
// thin wrapper over PGlite's real core sha256() (Postgres 14+ builtin,
// confirmed present) — same algorithm, same output, only the pgcrypto
// wrapper name differs. The real database has real pgcrypto (used
// unmodified by process_lemon_squeezy_event today), so this stub is a
// test-harness concession, not a change in behavior being tested.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const EVENTS_MIGRATION = path.join(MIGRATIONS_DIR, "20260729000000_hotmart_events.sql");
const RPC_MIGRATION = path.join(MIGRATIONS_DIR, "20260729010000_process_hotmart_event_rpc.sql");

const TEST_SECRET = "test-billing-rpc-secret";
const TEST_SECRET_HASH = createHash("sha256").update(TEST_SECRET).digest("hex");

const STUB_SCHEMA = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

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

-- Minimal stand-in for the real public.subscriptions (see
-- 20260704231647_.../20260707000000_lemon_squeezy_billing.sql /
-- 20260711000000_subscription_recency_guard.sql for the real column set)
-- — only the columns process_hotmart_event actually reads/writes.
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
  renews_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  provider_updated_at TIMESTAMPTZ,
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

CREATE TABLE public.billing_rpc_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  secret_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.billing_rpc_config (id, secret_hash) VALUES (TRUE, '${TEST_SECRET_HASH}');
`;

const USER_A = "00000000-0000-4000-8000-00000000000a";

async function insertPendingEvent(
  db: PGlite,
  args: { idempotencyKey: string; eventType: string; transactionId?: string; subscriptionId?: string },
) {
  await db.query(
    `INSERT INTO public.hotmart_events (idempotency_key, event_type, transaction_id, subscription_id, received_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [args.idempotencyKey, args.eventType, args.transactionId ?? null, args.subscriptionId ?? null],
  );
}

type RpcRow = { ok: boolean; message: string; notify_email: string | null; notify_kind: string | null; notify_plan: string | null };

async function callRpc(
  db: PGlite,
  args: {
    secret?: string;
    idempotencyKey: string;
    eventType: string;
    userId?: string | null;
    providerSubscriptionId?: string | null;
    providerCustomerId?: string | null;
    productId?: string | null;
    offerId?: string | null;
    status?: string | null;
    plan?: string | null;
    billingInterval?: string | null;
    creditsLimit?: number | null;
    renewsAt?: string | null;
    endsAt?: string | null;
    providerUpdatedAt?: string | null;
  },
): Promise<RpcRow> {
  const res = await db.query<RpcRow>(
    `SELECT * FROM public.process_hotmart_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      args.secret ?? TEST_SECRET,
      args.idempotencyKey,
      args.eventType,
      args.userId ?? null,
      args.providerSubscriptionId ?? null,
      args.providerCustomerId ?? null,
      args.productId ?? null,
      args.offerId ?? null,
      args.status ?? null,
      args.plan ?? null,
      args.billingInterval ?? null,
      args.creditsLimit ?? null,
      args.renewsAt ?? null,
      args.endsAt ?? null,
      args.providerUpdatedAt ?? null,
    ],
  );
  return res.rows[0];
}

describe("Hotmart migrations dry-run (local pglite, never the shared remote project)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(EVENTS_MIGRATION, "utf-8"));
    await db.exec(readFileSync(RPC_MIGRATION, "utf-8"));
    await db.query(`INSERT INTO public.users (id, email, plan, credits_used, credits_limit) VALUES ($1, 'a@test.com', 'free', 0, 10);`, [
      USER_A,
    ]);
  });

  afterEach(async () => {
    await db.close();
  });

  it("both migrations apply cleanly (schema + RPC create without error)", async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'hotmart%' ORDER BY table_name`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(["hotmart_events", "hotmart_pending_links"]);
  });

  it("rejects a wrong secret without applying anything", async () => {
    const row = await callRpc(db, {
      secret: "wrong",
      idempotencyKey: "k1".padEnd(32, "0"),
      eventType: "purchase_approved",
    });
    expect(row).toEqual(expect.objectContaining({ ok: false, message: "unauthorized" }));
  });

  it("rejects an unknown event_type", async () => {
    const row = await callRpc(db, { idempotencyKey: "k2".padEnd(32, "0"), eventType: "made_up_event" });
    expect(row.ok).toBe(false);
    expect(row.message).toBe("unknown event_type");
  });

  it("purchase_approved grants the resolved plan/credits and creates a subscriptions row", async () => {
    const key = "purchase1".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: key, eventType: "purchase_approved", transactionId: "TXN1" });
    const row = await callRpc(db, {
      idempotencyKey: key,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB1",
      offerId: "OFFER_PRO_MONTHLY",
      productId: "PROD1",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
      status: "active",
    });
    expect(row.ok).toBe(true);
    expect(row.notify_kind).toBe("pro_confirmation");

    const user = await db.query<{ plan: string; credits_limit: number }>(
      `SELECT plan, credits_limit FROM public.users WHERE id = $1`,
      [USER_A],
    );
    expect(user.rows[0]).toEqual({ plan: "pro", credits_limit: 100 });

    const sub = await db.query<{ status: string; cancelled: boolean; provider: string }>(
      `SELECT status, cancelled, provider FROM public.subscriptions WHERE provider_subscription_id = 'SUB1'`,
    );
    expect(sub.rows[0]).toEqual({ status: "active", cancelled: false, provider: "hotmart" });
  });

  it("a duplicate idempotency_key is a safe no-op — no double credit grant", async () => {
    const key = "dup1".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: key, eventType: "purchase_approved", transactionId: "TXN2" });
    await callRpc(db, {
      idempotencyKey: key,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB2",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
    });
    // Second call with the SAME idempotency_key — simulates a redelivered
    // webhook. The ledger row is already 'processed', so this must be a
    // no-op regardless of what mutation args are passed.
    const second = await callRpc(db, {
      idempotencyKey: key,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB2",
      plan: "business",
      billingInterval: "year",
      creditsLimit: 500,
    });
    expect(second).toEqual(expect.objectContaining({ ok: true, message: "already processed" }));

    const user = await db.query<{ plan: string; credits_limit: number }>(
      `SELECT plan, credits_limit FROM public.users WHERE id = $1`,
      [USER_A],
    );
    // Still 'pro'/100 from the FIRST call — the second (business/500) never applied.
    expect(user.rows[0]).toEqual({ plan: "pro", credits_limit: 100 });
  });

  it("subscription_cancelled marks cancelled but does NOT downgrade plan (grace period)", async () => {
    const purchaseKey = "cancelPurchase".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: purchaseKey, eventType: "purchase_approved" });
    await callRpc(db, {
      idempotencyKey: purchaseKey,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB3",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
    });

    const cancelKey = "cancelEvent".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: cancelKey, eventType: "subscription_cancelled" });
    const row = await callRpc(db, {
      idempotencyKey: cancelKey,
      eventType: "subscription_cancelled",
      providerSubscriptionId: "SUB3",
      status: "cancelled",
      endsAt: "2027-01-01T00:00:00Z",
    });
    expect(row.ok).toBe(true);

    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [USER_A]);
    expect(user.rows[0].plan).toBe("pro"); // unchanged — access continues until ends_at

    const sub = await db.query<{ cancelled: boolean; status: string }>(
      `SELECT cancelled, status FROM public.subscriptions WHERE provider_subscription_id = 'SUB3'`,
    );
    expect(sub.rows[0]).toEqual({ cancelled: true, status: "cancelled" });
  });

  it("refund downgrades to free without going below credits_used (no negative balance)", async () => {
    const purchaseKey = "refundPurchase".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: purchaseKey, eventType: "purchase_approved" });
    await callRpc(db, {
      idempotencyKey: purchaseKey,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB4",
      plan: "business",
      billingInterval: "month",
      creditsLimit: 500,
    });
    await db.query(`UPDATE public.users SET credits_used = 300 WHERE id = $1`, [USER_A]);

    const refundKey = "refundEvent".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: refundKey, eventType: "refund" });
    const row = await callRpc(db, {
      idempotencyKey: refundKey,
      eventType: "refund",
      providerSubscriptionId: "SUB4",
    });
    expect(row.ok).toBe(true);

    const user = await db.query<{ plan: string; credits_limit: number; credits_used: number }>(
      `SELECT plan, credits_limit, credits_used FROM public.users WHERE id = $1`,
      [USER_A],
    );
    expect(user.rows[0].plan).toBe("free");
    // floor is GREATEST(credits_used, 10) = GREATEST(300, 10) = 300 — never negative "remaining".
    expect(user.rows[0].credits_limit).toBe(300);

    const sub = await db.query<{ status: string }>(`SELECT status FROM public.subscriptions WHERE provider_subscription_id = 'SUB4'`);
    expect(sub.rows[0].status).toBe("refunded");
  });

  it("chargeback downgrades immediately with its own distinct status", async () => {
    const purchaseKey = "cbPurchase".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: purchaseKey, eventType: "purchase_approved" });
    await callRpc(db, {
      idempotencyKey: purchaseKey,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB5",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
    });

    const cbKey = "cbEvent".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: cbKey, eventType: "chargeback" });
    await callRpc(db, { idempotencyKey: cbKey, eventType: "chargeback", providerSubscriptionId: "SUB5" });

    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [USER_A]);
    expect(user.rows[0].plan).toBe("free");
    const sub = await db.query<{ status: string }>(`SELECT status FROM public.subscriptions WHERE provider_subscription_id = 'SUB5'`);
    expect(sub.rows[0].status).toBe("chargeback");
  });

  it("payment_failed notifies but never downgrades on its own", async () => {
    const purchaseKey = "pfPurchase".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: purchaseKey, eventType: "purchase_approved" });
    await callRpc(db, {
      idempotencyKey: purchaseKey,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB6",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
    });

    const pfKey = "pfEvent".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: pfKey, eventType: "payment_failed" });
    const row = await callRpc(db, { idempotencyKey: pfKey, eventType: "payment_failed", providerSubscriptionId: "SUB6" });
    expect(row.notify_kind).toBe("payment_failed");

    const user = await db.query<{ plan: string }>(`SELECT plan FROM public.users WHERE id = $1`, [USER_A]);
    expect(user.rows[0].plan).toBe("pro"); // unchanged
  });

  it("an older out-of-order event cannot regress state a newer event already applied", async () => {
    const purchaseKey = "orderPurchase".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: purchaseKey, eventType: "purchase_approved" });
    await callRpc(db, {
      idempotencyKey: purchaseKey,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB7",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
      providerUpdatedAt: "2027-06-01T00:00:00Z",
    });

    // A newer renewal lands first.
    const newKey = "orderNew".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: newKey, eventType: "renewal_approved" });
    await callRpc(db, {
      idempotencyKey: newKey,
      eventType: "renewal_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB7",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
      status: "active",
      providerUpdatedAt: "2027-06-03T00:00:00Z",
    });

    // A stale, older-timestamped duplicate delivery arrives after — must not
    // regress the status field via the WHERE guard on the upsert.
    const staleKey = "orderStale".padEnd(32, "0");
    await insertPendingEvent(db, { idempotencyKey: staleKey, eventType: "purchase_approved" });
    await callRpc(db, {
      idempotencyKey: staleKey,
      eventType: "purchase_approved",
      userId: USER_A,
      providerSubscriptionId: "SUB7",
      plan: "pro",
      billingInterval: "month",
      creditsLimit: 100,
      status: "stale_status_should_not_apply",
      providerUpdatedAt: "2027-06-01T00:00:00Z", // older than the renewal's timestamp above
    });

    const sub = await db.query<{ status: string }>(`SELECT status FROM public.subscriptions WHERE provider_subscription_id = 'SUB7'`);
    expect(sub.rows[0].status).toBe("active"); // from the renewal, not overwritten by the stale event
  });

  it("only anon (not authenticated, not PUBLIC) may execute the function", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.routine_privileges
       WHERE routine_name = 'process_hotmart_event'`,
    );
    const granted = grants.rows.map((r) => `${r.grantee}:${r.privilege_type}`);
    expect(granted).toContain("anon:EXECUTE");
    expect(granted.some((g) => g.startsWith("authenticated:"))).toBe(false);
    expect(granted.some((g) => g.startsWith("PUBLIC:"))).toBe(false);
  });
});
