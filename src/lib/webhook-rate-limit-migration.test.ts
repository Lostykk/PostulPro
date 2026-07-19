import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of supabase/migrations/20260729020000_webhook_rate_limit.sql
// against pglite — never the shared remote Supabase project. See
// src/lib/hotmart/hotmart-events-migration.test.ts for why extensions.digest
// is stubbed via pglite's real core sha256().

const MIGRATION = path.resolve(__dirname, "../../supabase/migrations/20260729020000_webhook_rate_limit.sql");

const TEST_SECRET = "test-billing-rpc-secret";
const TEST_SECRET_HASH = createHash("sha256").update(TEST_SECRET).digest("hex");

const STUB_SCHEMA = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE FUNCTION extensions.digest(data TEXT, algo TEXT) RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(data::bytea) $$;

CREATE TABLE public.billing_rpc_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  secret_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.billing_rpc_config (id, secret_hash) VALUES (TRUE, '${TEST_SECRET_HASH}');
`;

async function claim(db: PGlite, key: string, windowSeconds = 60, maxRequests = 3, secret = TEST_SECRET) {
  const res = await db.query<{ allowed: boolean; remaining: number; reset_at: string }>(
    `SELECT * FROM public.claim_webhook_rate_limit($1, $2, $3, $4)`,
    [secret, key, windowSeconds, maxRequests],
  );
  return res.rows[0];
}

describe("webhook rate limit migration dry-run (local pglite)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(MIGRATION, "utf-8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("rejects a wrong secret entirely (raises, no bucket consumed)", async () => {
    await expect(claim(db, "ip:1.2.3.4", 60, 3, "wrong-secret")).rejects.toThrow();
  });

  it("allows up to max_requests within the window, then denies", async () => {
    const first = await claim(db, "ip:1.2.3.4");
    const second = await claim(db, "ip:1.2.3.4");
    const third = await claim(db, "ip:1.2.3.4");
    const fourth = await claim(db, "ip:1.2.3.4");

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(true);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("different rate keys are tracked independently", async () => {
    await claim(db, "ip:1.1.1.1");
    await claim(db, "ip:1.1.1.1");
    await claim(db, "ip:1.1.1.1");
    const otherKeyStillAllowed = await claim(db, "ip:2.2.2.2");
    expect(otherKeyStillAllowed.allowed).toBe(true);
  });

  it("only anon (not authenticated, not PUBLIC) may execute the function", async () => {
    const grants = await db.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.routine_privileges
       WHERE routine_name = 'claim_webhook_rate_limit'`,
    );
    const granted = grants.rows.map((r) => `${r.grantee}:${r.privilege_type}`);
    expect(granted).toContain("anon:EXECUTE");
    expect(granted.some((g) => g.startsWith("authenticated:"))).toBe(false);
    expect(granted.some((g) => g.startsWith("PUBLIC:"))).toBe(false);
  });
});
