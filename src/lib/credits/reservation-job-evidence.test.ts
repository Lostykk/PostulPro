import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only validation of
// supabase/migrations/20260728000000_reservation_job_evidence.sql against
// a real (WASM, in-memory) Postgres engine — NEVER the shared remote
// Supabase project. Runs on top of the already-applied
// 20260727000000_credit_reservations_idempotent_refund.sql migration,
// exactly matching the two-migration state the real database would be in
// once this one is authorized and applied.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const BASE_MIGRATION = path.join(
  MIGRATIONS_DIR,
  "20260727000000_credit_reservations_idempotent_refund.sql",
);
const EVIDENCE_MIGRATION = path.join(MIGRATIONS_DIR, "20260728000000_reservation_job_evidence.sql");

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
  credits_limit INT NOT NULL DEFAULT 1000
);

CREATE TABLE public.generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
);

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

describe("reservation job evidence + reconcile_stale_reservations_v2 (local pglite)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(BASE_MIGRATION, "utf-8"));
    await db.exec(readFileSync(EVIDENCE_MIGRATION, "utf-8"));
    await db.query(
      `INSERT INTO public.users (id, credits_used, credits_limit) VALUES ($1, 0, 1000), ($2, 0, 1000);`,
      [USER_A, USER_B],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  async function reserve(cost: number, tool = "copywriter") {
    await setUser(db, USER_A);
    const res = await db.query<{
      ok: boolean;
      credits_used: number;
      credits_limit: number;
      reservation_id: string | null;
    }>(`SELECT * FROM public.reserve_credits_v2($1, $2);`, [cost, tool]);
    return res.rows[0];
  }

  async function creditsOf(uid: string) {
    const res = await db.query<{ credits_used: number }>(
      `SELECT credits_used FROM public.users WHERE id = $1;`,
      [uid],
    );
    return res.rows[0].credits_used;
  }

  async function statusOf(reservationId: string) {
    const res = await db.query<{ status: string }>(
      `SELECT status FROM public.credit_reservations WHERE id = $1;`,
      [reservationId],
    );
    return res.rows[0]?.status;
  }

  async function ageReservation(reservationId: string, interval: string) {
    await db.query(
      `UPDATE public.credit_reservations SET created_at = NOW() - $2::INTERVAL WHERE id = $1;`,
      [reservationId, interval],
    );
  }

  async function linkGeneration(reservationId: string, userId: string, genId: string) {
    await db.query(
      `INSERT INTO public.generations (id, user_id, credit_reservation_id) VALUES ($1, $2, $3);`,
      [genId, userId, reservationId],
    );
  }

  async function markOutcome(
    reservationId: string,
    outcome: "failed" | "aborted" | "timed_out",
    asUser = USER_A,
    reason: string | null = null,
  ) {
    await setUser(db, asUser);
    const res = await db.query<{ mark_reservation_job_outcome: boolean }>(
      `SELECT public.mark_reservation_job_outcome($1, $2, $3) AS mark_reservation_job_outcome;`,
      [reservationId, outcome, reason],
    );
    return res.rows[0].mark_reservation_job_outcome;
  }

  async function reconcile(batchLimit = 200) {
    const res = await db.query<{ reservation_id: string; outcome: string; evidence: string }>(
      `SELECT * FROM public.reconcile_stale_reservations_v2($1);`,
      [batchLimit],
    );
    return res.rows;
  }

  // --- 13. reconciliador sobre completed ---
  it("a reservation with a linked generations row reconciles to consumed, even fresh", async () => {
    const r = await reserve(2);
    await linkGeneration(r.reservation_id!, USER_A, "10000000-0000-4000-8000-000000000001");

    const results = await reconcile();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      reservation_id: r.reservation_id,
      outcome: "consumed",
      evidence: "linked_generation",
    });
    expect(await statusOf(r.reservation_id!)).toBe("consumed");
    // Consuming never touches the balance — already charged at reserve time.
    expect(await creditsOf(USER_A)).toBe(2);
  });

  // --- 14. reconciliador sobre failed ---
  it("a reservation with confirmed job_outcome='failed' reconciles to refunded, even fresh", async () => {
    const r = await reserve(3);
    expect(await markOutcome(r.reservation_id!, "failed")).toBe(true);

    const results = await reconcile();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      reservation_id: r.reservation_id,
      outcome: "refunded",
      evidence: "failed",
    });
    expect(await statusOf(r.reservation_id!)).toBe("refunded");
    expect(await creditsOf(USER_A)).toBe(0);
  });

  // --- 15. reconciliador sobre aborted ---
  it("a reservation with confirmed job_outcome='aborted' reconciles to refunded, even fresh", async () => {
    const r = await reserve(1);
    expect(await markOutcome(r.reservation_id!, "aborted")).toBe(true);

    const results = await reconcile();
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("refunded");
    expect(results[0].evidence).toBe("aborted");
    expect(await creditsOf(USER_A)).toBe(0);
  });

  it("a reservation with confirmed job_outcome='timed_out' reconciles to refunded, even fresh", async () => {
    const r = await reserve(1);
    expect(await markOutcome(r.reservation_id!, "timed_out")).toBe(true);

    const results = await reconcile();
    expect(results[0].outcome).toBe("refunded");
    expect(results[0].evidence).toBe("timed_out");
  });

  // --- 16. reconciliador sobre job todavía activo (no evidence, fresh) ---
  it("a fresh reservation with no evidence either way is left untouched", async () => {
    const r = await reserve(2);
    const results = await reconcile();
    expect(results).toHaveLength(0);
    expect(await statusOf(r.reservation_id!)).toBe("reserved");
    expect(await creditsOf(USER_A)).toBe(2); // still charged, still reserved — not refunded blindly
  });

  it("a reservation with no evidence is left untouched even well past a short-tool threshold if the tool is slow", async () => {
    // business-plan's threshold is 30 minutes; 20 minutes old must not trigger the fallback.
    const r = await reserve(5, "business-plan");
    await ageReservation(r.reservation_id!, "20 minutes");
    const results = await reconcile();
    expect(results).toHaveLength(0);
    expect(await statusOf(r.reservation_id!)).toBe("reserved");
  });

  // --- 20. reserva sin generación asociada, umbral por herramienta ---
  it("a reservation with no evidence past its tool's safe threshold is refunded via the age fallback", async () => {
    const fast = await reserve(1, "copywriter"); // 10 min threshold
    await ageReservation(fast.reservation_id!, "11 minutes");

    const results = await reconcile();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      reservation_id: fast.reservation_id,
      outcome: "refunded",
      evidence: "no_evidence_after_threshold",
    });
    expect(await creditsOf(USER_A)).toBe(0);
  });

  it("different tools use different safe thresholds — a slow tool needs longer before the fallback fires", async () => {
    const slow = await reserve(5, "business-plan"); // 30 min threshold
    await ageReservation(slow.reservation_id!, "25 minutes");
    expect(await reconcile()).toHaveLength(0); // not old enough yet for business-plan

    await ageReservation(slow.reservation_id!, "31 minutes");
    const results = await reconcile();
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("refunded");
  });

  // --- 17. reconciliador repetido dos veces ---
  it("running the reconciler twice is idempotent — nothing left to reconcile the second time", async () => {
    const r = await reserve(3);
    await markOutcome(r.reservation_id!, "failed");

    const first = await reconcile();
    expect(first).toHaveLength(1);
    const second = await reconcile();
    expect(second).toHaveLength(0);
    expect(await creditsOf(USER_A)).toBe(0); // refunded exactly once, not twice
  });

  // --- 18. reserva ajena ---
  it("mark_reservation_job_outcome rejects marking a reservation owned by another user", async () => {
    const r = await reserve(2); // owned by USER_A
    const marked = await markOutcome(r.reservation_id!, "failed", USER_B);
    expect(marked).toBe(false);
    // No evidence was recorded, so it's still untouched by the reconciler.
    const results = await reconcile();
    expect(results).toHaveLength(0);
  });

  it("the reconciler never touches a reservation belonging to a different, unrelated user in the same batch", async () => {
    await setUser(db, USER_B);
    const bReserve = await db.query<{ reservation_id: string }>(
      `SELECT * FROM public.reserve_credits_v2($1, $2);`,
      [4, "copywriter"],
    );
    const bReservationId = bReserve.rows[0].reservation_id!;
    // USER_B's reservation stays fresh/untouched; only USER_A's aged one should resolve.
    const aReserve = await reserve(2, "copywriter");
    await ageReservation(aReserve.reservation_id!, "11 minutes");

    const results = await reconcile();
    expect(results).toHaveLength(1);
    expect(results[0].reservation_id).toBe(aReserve.reservation_id);
    expect(await statusOf(bReservationId)).toBe("reserved");
    expect(await creditsOf(USER_B)).toBe(4); // untouched
  });

  // --- 19. lote con estados mixtos ---
  it("a single reconcile call correctly resolves a mixed batch: completed, failed, active, and stale-no-evidence", async () => {
    const completed = await reserve(1, "copywriter");
    await linkGeneration(completed.reservation_id!, USER_A, "10000000-0000-4000-8000-000000000010");

    const failed = await reserve(2, "sales-email");
    await markOutcome(failed.reservation_id!, "failed");

    const active = await reserve(3, "copywriter"); // fresh, no evidence — must be left alone

    const staleNoEvidence = await reserve(1, "landing-copy"); // 10 min threshold
    await ageReservation(staleNoEvidence.reservation_id!, "15 minutes");

    const results = await reconcile();
    const byId = new Map(results.map((r) => [r.reservation_id, r]));

    expect(byId.get(completed.reservation_id!)).toMatchObject({ outcome: "consumed" });
    expect(byId.get(failed.reservation_id!)).toMatchObject({
      outcome: "refunded",
      evidence: "failed",
    });
    expect(byId.get(staleNoEvidence.reservation_id!)).toMatchObject({
      outcome: "refunded",
      evidence: "no_evidence_after_threshold",
    });
    expect(byId.has(active.reservation_id!)).toBe(false);
    expect(await statusOf(active.reservation_id!)).toBe("reserved");

    // 1 + 2 + 3 + 1 = 7 reserved; consumed keeps its 1, failed/stale refund back 2+1=3, active still holds 3.
    expect(await creditsOf(USER_A)).toBe(1 + 3); // completed's 1 (kept) + active's 3 (still reserved)
  });

  // --- job_outcome is set-once (idempotent evidence, doesn't get overwritten) ---
  it("job_outcome can only be set once — a second, contradictory mark is ignored", async () => {
    const r = await reserve(2);
    expect(await markOutcome(r.reservation_id!, "failed")).toBe(true);
    expect(await markOutcome(r.reservation_id!, "timed_out")).toBe(false); // already has an outcome, ignored

    const row = await db.query<{ job_outcome: string }>(
      `SELECT job_outcome FROM public.credit_reservations WHERE id = $1;`,
      [r.reservation_id],
    );
    expect(row.rows[0].job_outcome).toBe("failed"); // unchanged
  });

  it("job_outcome evidence alone does not bypass the reconciler noticing a later completion link — completion wins if both exist", async () => {
    // Defensive ordering check: if a generation somehow does get linked
    // despite an earlier failure mark (e.g. a slow success arriving after
    // a timeout was recorded), the reconciler must prefer the positive
    // completion evidence over the negative job_outcome evidence — never
    // discard real, delivered output.
    const r = await reserve(2);
    await markOutcome(r.reservation_id!, "timed_out");
    await linkGeneration(r.reservation_id!, USER_A, "10000000-0000-4000-8000-000000000099");

    const results = await reconcile();
    expect(results[0]).toMatchObject({ outcome: "consumed", evidence: "linked_generation" });
    expect(await creditsOf(USER_A)).toBe(2);
  });

  it("old reserve_credits_v2/resolve_credit_reservation and reconcile_stale_reservations remain intact and unaffected", async () => {
    const r = await reserve(2);
    await setUser(db, USER_A);
    const resolved = await db.query<{ resolved: boolean; final_status: string }>(
      `SELECT * FROM public.resolve_credit_reservation($1, $2, $3, $4);`,
      [r.reservation_id, "consumed", null, null],
    );
    expect(resolved.rows[0].resolved).toBe(true);
    expect(resolved.rows[0].final_status).toBe("consumed");

    const blindReconcile = await db.query(`SELECT * FROM public.reconcile_stale_reservations(30);`);
    expect(blindReconcile.rows).toHaveLength(0); // nothing stale to touch
  });
});
