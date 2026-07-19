import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of the Fase 8C processing_status-widening migration
// against a real (WASM, in-memory) Postgres engine — NEVER the shared
// remote Supabase project. See hotmart-events-migration.test.ts for the
// same dry-run discipline applied to the original two Hotmart migrations.

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const EVENTS_MIGRATION = path.join(MIGRATIONS_DIR, "20260729000000_hotmart_events.sql");
const EXPANSION_MIGRATION = path.join(MIGRATIONS_DIR, "20260731000000_hotmart_events_status_expansion.sql");

const STUB_SCHEMA = `
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE TABLE public.users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL DEFAULT 'test@example.com'
);
`;

async function insertRow(db: PGlite, idempotencyKey: string, status: string): Promise<Error | null> {
  try {
    await db.query(
      `INSERT INTO public.hotmart_events (idempotency_key, event_type, processing_status) VALUES ($1, 'purchase_approved', $2)`,
      [idempotencyKey, status],
    );
    return null;
  } catch (err) {
    return err as Error;
  }
}

describe("Hotmart processing_status expansion migration (local pglite, never the shared remote project)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(EVENTS_MIGRATION, "utf-8"));
    await db.exec(readFileSync(EXPANSION_MIGRATION, "utf-8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("applies cleanly on top of the original hotmart_events migration", async () => {
    const constraint = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'hotmart_events_processing_status_check'`,
    );
    expect(constraint.rows).toHaveLength(1);
  });

  it("still accepts every legacy status value (backward compatible, no data touched)", async () => {
    for (const status of ["pending", "processed", "ignored", "error"]) {
      const err = await insertRow(db, `legacy-${status}`, status);
      expect(err, status).toBeNull();
    }
  });

  it("accepts every new Fase 8C status value", async () => {
    for (const status of [
      "ignored_test",
      "unsupported",
      "unmapped_offer",
      "no_action_required",
      "invalid_payload",
      "pending_link",
      "failed",
    ]) {
      const err = await insertRow(db, `new-${status}`, status);
      expect(err, status).toBeNull();
    }
  });

  it("still rejects an unrecognized status value", async () => {
    const err = await insertRow(db, "bogus", "totally_made_up_status");
    expect(err).not.toBeNull();
  });
});
