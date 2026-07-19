import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only validation of supabase/migrations/20260727000000_credit_reservations_idempotent_refund.sql
// against a real (WASM, in-memory) Postgres engine — NEVER the shared
// remote Supabase project. This is exactly the "static/local validation
// that doesn't touch the remote DB" the migration's own review process
// requires before anyone authorizes `supabase db push`.
//
// The migration file itself is read from disk and executed verbatim
// (not retyped here) so these tests exercise the actual SQL that would
// be applied, not a paraphrase of it.

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260727000000_credit_reservations_idempotent_refund.sql",
);

// Minimal stand-ins for objects the migration assumes already exist in
// the real database (created by earlier migrations, not part of this
// one): auth.uid(), has_role(), users, generations, and the pre-existing
// refund_credits() the new RPC calls into.
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
  credits_used INT NOT NULL DEFAULT 0,
  credits_limit INT NOT NULL DEFAULT 100
);

CREATE TABLE public.generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
);

-- Verbatim copy of the existing, untouched function from
-- 20260705000000_secure_credits_and_onboarding.sql — the new migration
-- calls this exact function and must not need to modify it.
CREATE OR REPLACE FUNCTION public.refund_credits(p_cost INT)
RETURNS TABLE(credits_used INT, credits_limit INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_used INT;
  v_limit INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Invalid cost';
  END IF;

  UPDATE public.users
  SET credits_used = GREATEST(0, public.users.credits_used - p_cost)
  WHERE id = v_uid
  RETURNING public.users.credits_used, public.users.credits_limit INTO v_used, v_limit;

  RETURN QUERY SELECT v_used, v_limit;
END;
$$;
`;

async function setUser(db: PGlite, uid: string | null) {
  await db.exec(`DELETE FROM _test_session;`);
  if (uid) await db.query(`INSERT INTO _test_session (uid) VALUES ($1);`, [uid]);
}

const USER_A = "00000000-0000-4000-8000-00000000000a";
const USER_B = "00000000-0000-4000-8000-00000000000b";

describe("credit_reservations migration (local pglite, never touches remote Supabase)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    const migrationSql = readFileSync(MIGRATION_PATH, "utf-8");
    await db.exec(migrationSql);
    await db.query(`INSERT INTO public.users (id, credits_used, credits_limit) VALUES ($1, 0, 10), ($2, 0, 10);`, [
      USER_A,
      USER_B,
    ]);
  });

  afterEach(async () => {
    await db.close();
  });

  async function reserve(cost: number, tool = "test-tool") {
    await setUser(db, USER_A);
    const res = await db.query<{ ok: boolean; credits_used: number; credits_limit: number; reservation_id: string | null }>(
      `SELECT * FROM public.reserve_credits_v2($1, $2);`,
      [cost, tool],
    );
    return res.rows[0];
  }

  async function resolve(
    reservationId: string,
    outcome: "consumed" | "refunded",
    opts: { generationId?: string | null; reason?: string | null; asUser?: string } = {},
  ) {
    await setUser(db, opts.asUser ?? USER_A);
    const res = await db.query<{ resolved: boolean; final_status: string; refunded_cost: number | null }>(
      `SELECT * FROM public.resolve_credit_reservation($1, $2, $3, $4);`,
      [reservationId, outcome, opts.generationId ?? null, opts.reason ?? null],
    );
    return res.rows[0];
  }

  async function creditsOf(uid: string) {
    const res = await db.query<{ credits_used: number; credits_limit: number }>(
      `SELECT credits_used, credits_limit FROM public.users WHERE id = $1;`,
      [uid],
    );
    return res.rows[0];
  }

  it("successful generation: charges once, resolves as consumed, never refunds", async () => {
    const reserve1 = await reserve(3);
    expect(reserve1.ok).toBe(true);
    expect((await creditsOf(USER_A)).credits_used).toBe(3);

    const resolved = await resolve(reserve1.reservation_id!, "consumed");
    expect(resolved.resolved).toBe(true);
    expect(resolved.final_status).toBe("consumed");
    // Consuming never touches the balance — it was already charged at reserve time.
    expect((await creditsOf(USER_A)).credits_used).toBe(3);
  });

  it("insufficient balance: reservation is rejected, no row created, no charge", async () => {
    const reserve1 = await reserve(11); // limit is 10
    expect(reserve1.ok).toBe(false);
    expect(reserve1.reservation_id).toBeNull();
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("failure before generating: refunds exactly once", async () => {
    const reserve1 = await reserve(4);
    expect((await creditsOf(USER_A)).credits_used).toBe(4);

    const resolved = await resolve(reserve1.reservation_id!, "refunded", { reason: "provider_error" });
    expect(resolved.resolved).toBe(true);
    expect(resolved.final_status).toBe("refunded");
    expect(resolved.refunded_cost).toBe(4);
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("client abort: refunds exactly once (same path as any other failure)", async () => {
    const reserve1 = await reserve(2);
    const resolved = await resolve(reserve1.reservation_id!, "refunded", { reason: "client_disconnected" });
    expect(resolved.resolved).toBe(true);
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("provider timeout: refunds exactly once", async () => {
    const reserve1 = await reserve(5);
    const resolved = await resolve(reserve1.reservation_id!, "refunded", { reason: "provider_timeout" });
    expect(resolved.resolved).toBe(true);
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("two aborts on the same reservation: only ONE refund is ever applied", async () => {
    const reserve1 = await reserve(6);
    expect((await creditsOf(USER_A)).credits_used).toBe(6);

    const first = await resolve(reserve1.reservation_id!, "refunded", { reason: "client_disconnected" });
    const second = await resolve(reserve1.reservation_id!, "refunded", { reason: "client_disconnected" });

    expect(first.resolved).toBe(true);
    expect(second.resolved).toBe(false); // no-op, already refunded
    expect(second.final_status).toBe("refunded");
    expect(second.refunded_cost).toBeNull();
    // Refunded exactly once, not twice.
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("later retry of the same resolve call never duplicates the refund", async () => {
    const reserve1 = await reserve(3);
    await resolve(reserve1.reservation_id!, "refunded");
    // Simulate a client retry hitting the same reservation id again, well after the first call.
    const retry = await resolve(reserve1.reservation_id!, "refunded");
    expect(retry.resolved).toBe(false);
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("consumed vs refunded race on the same reservation: exactly one outcome wins, never both", async () => {
    const reserve1 = await reserve(4);

    const consumeResult = await resolve(reserve1.reservation_id!, "consumed");
    const refundResult = await resolve(reserve1.reservation_id!, "refunded", { reason: "late_abort" });

    // First call (consumed) wins because it's issued first in this
    // sequential simulation — Postgres's row lock on UPDATE guarantees
    // this same "first commit wins, second finds nothing to change"
    // behavior under true concurrent connections too, since the WHERE
    // status='reserved' check is re-evaluated against the post-lock row
    // state, not a stale snapshot. Sequential calls prove the state-
    // machine logic is correct; the concurrency guarantee itself rests
    // on Postgres's standard row-level locking semantics (not
    // independently re-verified here with two real parallel
    // connections — noted as a residual scope limitation).
    expect(consumeResult.resolved).toBe(true);
    expect(consumeResult.final_status).toBe("consumed");
    expect(refundResult.resolved).toBe(false);
    expect(refundResult.final_status).toBe("consumed"); // stayed consumed, never flipped to refunded
    // Credits charged at reserve time, never refunded — consumed wins.
    expect((await creditsOf(USER_A)).credits_used).toBe(4);
  });

  it("refunded reservation can never later become consumed", async () => {
    const reserve1 = await reserve(4);
    await resolve(reserve1.reservation_id!, "refunded");
    const lateConsume = await resolve(reserve1.reservation_id!, "consumed");
    expect(lateConsume.resolved).toBe(false);
    expect(lateConsume.final_status).toBe("refunded");
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("a user cannot resolve another user's reservation", async () => {
    const reserve1 = await reserve(4); // reserved by USER_A
    const attempt = await resolve(reserve1.reservation_id!, "refunded", { asUser: USER_B });
    expect(attempt.resolved).toBe(false);
    // USER_B's own balance is untouched, and USER_A's reservation is
    // still sitting there reserved (not refunded by the wrong caller).
    expect((await creditsOf(USER_B)).credits_used).toBe(0);
    expect((await creditsOf(USER_A)).credits_used).toBe(4);
    const check = await db.query<{ status: string }>(
      `SELECT status FROM public.credit_reservations WHERE id = $1;`,
      [reserve1.reservation_id],
    );
    expect(check.rows[0].status).toBe("reserved");
  });

  it("resolving after the 'HTTP response' has conceptually already finished still completes (this is the whole point of a persistent ledger + waitUntil)", async () => {
    // Nothing in this RPC depends on any HTTP/response object at all —
    // it's a plain database call. This test exists to make explicit
    // that resolve_credit_reservation succeeding has zero dependency on
    // whether the original request/response is still "open": the ledger
    // row is the only state that matters, and it was already durably
    // committed at reserve time.
    const reserve1 = await reserve(2);
    // ... time passes, the Worker's Response has long since closed ...
    const resolved = await resolve(reserve1.reservation_id!, "refunded");
    expect(resolved.resolved).toBe(true);
    expect((await creditsOf(USER_A)).credits_used).toBe(0);
  });

  it("associates generation_id when it genuinely belongs to the resolving user", async () => {
    const reserve1 = await reserve(2);
    const genId = "10000000-0000-4000-8000-000000000003";
    await db.query(`INSERT INTO public.generations (id, user_id) VALUES ($1, $2);`, [genId, USER_A]);

    await resolve(reserve1.reservation_id!, "consumed", { generationId: genId });

    const row = await db.query<{ generation_id: string | null }>(
      `SELECT generation_id FROM public.credit_reservations WHERE id = $1;`,
      [reserve1.reservation_id],
    );
    expect(row.rows[0].generation_id).toBe(genId);
  });

  it("associates generation_id only when it belongs to the resolving user", async () => {
    const reserve1 = await reserve(2);
    await db.query(`INSERT INTO public.generations (id, user_id) VALUES ($1, $2);`, [
      "10000000-0000-4000-8000-000000000001",
      USER_A,
    ]);
    await db.query(`INSERT INTO public.generations (id, user_id) VALUES ($1, $2);`, [
      "10000000-0000-4000-8000-000000000002",
      USER_B,
    ]);

    // Attempt to associate USER_B's generation while resolving as USER_A — must be ignored, not linked.
    await resolve(reserve1.reservation_id!, "consumed", {
      generationId: "10000000-0000-4000-8000-000000000002",
    });
    const row = await db.query<{ generation_id: string | null }>(
      `SELECT generation_id FROM public.credit_reservations WHERE id = $1;`,
      [reserve1.reservation_id],
    );
    expect(row.rows[0].generation_id).toBeNull();
  });

  it("stale reconciliation refunds an abandoned reservation exactly once, and never touches a consumed one", async () => {
    const abandoned = await reserve(3);
    const legit = await reserve(2);
    await resolve(legit.reservation_id!, "consumed"); // this one succeeded normally

    // Force the abandoned reservation to look old.
    await db.query(`UPDATE public.credit_reservations SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1;`, [
      abandoned.reservation_id,
    ]);

    const result = await db.query<{ reservation_id: string; outcome: string }>(
      `SELECT * FROM public.reconcile_stale_reservations(30);`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].reservation_id).toBe(abandoned.reservation_id);
    expect(result.rows[0].outcome).toBe("refunded");

    // Abandoned one refunded, legit consumed one untouched.
    expect((await creditsOf(USER_A)).credits_used).toBe(2); // 3+2 reserved, 3 refunded back = 2 left (the consumed one)

    // Running reconciliation again is a no-op (idempotent) — nothing left to reconcile.
    const second = await db.query(`SELECT * FROM public.reconcile_stale_reservations(30);`);
    expect(second.rows).toHaveLength(0);
  });

  it("reconciliation never refunds a reservation younger than the threshold", async () => {
    const fresh = await reserve(3);
    const result = await db.query(`SELECT * FROM public.reconcile_stale_reservations(30);`);
    expect(result.rows).toHaveLength(0);
    expect((await creditsOf(USER_A)).credits_used).toBe(3); // untouched, still reserved
    const row = await db.query<{ status: string }>(`SELECT status FROM public.credit_reservations WHERE id = $1;`, [
      fresh.reservation_id,
    ]);
    expect(row.rows[0].status).toBe("reserved");
  });

  it("old reserve_credits/refund_credits functions are untouched and still callable independently", async () => {
    // This migration must not require dropping or altering the
    // pre-existing functions — refund_credits is called directly here,
    // outside the reservation flow entirely, exactly as
    // 20260705000000 originally defined it.
    await setUser(db, USER_A);
    await db.query(`UPDATE public.users SET credits_used = 5 WHERE id = $1;`, [USER_A]);
    const res = await db.query<{ credits_used: number }>(`SELECT * FROM public.refund_credits(2);`);
    expect(res.rows[0].credits_used).toBe(3);
  });
});
