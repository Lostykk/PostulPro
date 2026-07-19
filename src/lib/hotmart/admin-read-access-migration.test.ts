import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

// Local-only dry-run of
// supabase/migrations/20260729050000_hotmart_admin_read_access.sql
// against pglite — never the shared remote Supabase project.
//
// This confirms the migration applies cleanly and grants exactly SELECT
// to `authenticated` (RLS then further restricts that to admin-only rows
// — not independently simulated here via SET ROLE the way the schema
// tests elsewhere in this project don't either; the policy text itself
// is the same `has_role(auth.uid(), 'admin')` pattern already proven
// correct and exercised live for every other admin-only table in this
// codebase).

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");
const EVENTS_MIGRATION = path.join(MIGRATIONS_DIR, "20260729000000_hotmart_events.sql");
const ACCESS_MIGRATION = path.join(MIGRATIONS_DIR, "20260729050000_hotmart_admin_read_access.sql");

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
CREATE TABLE public.users (id UUID PRIMARY KEY);
`;

describe("hotmart admin read access migration dry-run (local pglite)", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STUB_SCHEMA);
    await db.exec(readFileSync(EVENTS_MIGRATION, "utf-8"));
    await db.exec(readFileSync(ACCESS_MIGRATION, "utf-8"));
  });

  afterEach(async () => {
    await db.close();
  });

  it("applies cleanly and grants SELECT (only) to authenticated on both tables", async () => {
    for (const table of ["hotmart_events", "hotmart_pending_links"]) {
      const grants = await db.query<{ grantee: string; privilege_type: string }>(
        `SELECT grantee, privilege_type FROM information_schema.table_privileges WHERE table_name = $1 AND grantee = 'authenticated'`,
        [table],
      );
      const privileges = grants.rows.map((r) => r.privilege_type);
      expect(privileges).toEqual(["SELECT"]);
    }
  });

  it("anon has no grants on either table", async () => {
    for (const table of ["hotmart_events", "hotmart_pending_links"]) {
      const grants = await db.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges WHERE table_name = $1 AND grantee = 'anon'`,
        [table],
      );
      expect(grants.rows).toEqual([]);
    }
  });

  it("both admin-read policies exist and reference has_role", async () => {
    const policies = await db.query<{ policyname: string; qual: string }>(
      `SELECT policyname, qual FROM pg_policies WHERE tablename IN ('hotmart_events', 'hotmart_pending_links')`,
    );
    expect(policies.rows).toHaveLength(2);
    for (const row of policies.rows) {
      expect(row.qual).toContain("has_role");
    }
  });
});
