import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_FIXTURE_PATH = path.resolve(__dirname, "../.qa.local.json");

function loadQaAccount(): { email: string; password: string } | null {
  if (!existsSync(QA_FIXTURE_PATH)) return null;
  const raw = JSON.parse(readFileSync(QA_FIXTURE_PATH, "utf-8"));
  return { email: raw.email, password: raw.password };
}

const qa = loadQaAccount();

async function login(page: Page) {
  await page.goto("/auth/login");
  await page.getByPlaceholder("vos@ejemplo.com").fill(qa!.email);
  await page.getByPlaceholder(/contraseña|••/i).fill(qa!.password);
  await page.getByRole("button", { name: /ingresar/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

// Same pattern as e2e/permissions-rls.spec.ts: calls the real Supabase
// REST/RPC API directly with the QA account's own session — this is the
// only way to prove the DEPLOYED objects (table, RLS, grants, RPCs)
// actually behave correctly against ccpejnklrfvgtwryqfrw, the real
// shared backend, as opposed to what the migration file merely says on
// paper. All costs are 1 credit (the tool catalog's minimum), and
// nothing here touches any other user's data.
async function supabaseRequest(page: Page, pathAndQuery: string, init: { method: string; body?: unknown }) {
  return page.evaluate(
    async ({ pathAndQuery, init }) => {
      const raw = Object.keys(window.localStorage)
        .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
        .map((k) => window.localStorage.getItem(k))
        .find(Boolean);
      if (!raw) throw new Error("No Supabase session found in localStorage");
      const session = JSON.parse(raw as string);
      const accessToken = session.access_token as string;
      const apikey = (window as unknown as { __qaSbApiKey?: string }).__qaSbApiKey;
      if (!apikey) throw new Error("No Supabase publishable key available in page context");

      const res = await fetch(`https://ccpejnklrfvgtwryqfrw.supabase.co/rest/v1/${pathAndQuery}`, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          apikey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: init.method === "POST" || init.method === "PATCH" ? "return=representation" : "return=minimal",
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, json };
    },
    { pathAndQuery, init },
  );
}

async function reserve(page: Page, cost = 1, tool = "qa-e2e-ledger-probe") {
  const res = await supabaseRequest(page, "rpc/reserve_credits_v2", {
    method: "POST",
    body: { p_cost: cost, p_tool: tool },
  });
  const row = Array.isArray(res.json) ? res.json[0] : null;
  return row as { ok: boolean; credits_used: number; credits_limit: number; reservation_id: string | null } | null;
}

function resolve(page: Page, reservationId: string, outcome: "consumed" | "refunded") {
  return supabaseRequest(page, "rpc/resolve_credit_reservation", {
    method: "POST",
    body: { p_reservation_id: reservationId, p_outcome: outcome, p_generation_id: null, p_reason: null },
  });
}

test.describe("credit_reservations — live verification against the deployed Supabase (real backend, real concurrency)", () => {
  test.skip(!qa, "No .qa.local.json fixture in this environment — skipping account-based checks");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __qaSbApiKey?: string }).__qaSbApiKey =
        "sb_publishable_PXzGESMpOsoeDZPb8JKPqQ_wRTHTCPs";
    });
    await login(page);
  });

  test("reserve_credits_v2 exists, works, and RLS lets the owner read their own reservation", async ({ page }) => {
    const reserved = await reserve(page);
    expect(reserved?.ok).toBe(true);
    expect(reserved?.reservation_id).toBeTruthy();

    const read = await supabaseRequest(
      page,
      `credit_reservations?id=eq.${reserved!.reservation_id}&select=id,status,cost,tool`,
      { method: "GET" },
    );
    expect(read.status).toBe(200);
    const rows = read.json as Array<{ status: string; cost: number; tool: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("reserved");
    expect(rows[0].cost).toBe(1);
    expect(rows[0].tool).toBe("qa-e2e-ledger-probe");

    // Clean up — this test's only purpose was to prove the reserve+read
    // path works, not to leave a dangling reservation on the shared QA
    // account.
    await resolve(page, reserved!.reservation_id!, "refunded");
  });

  test("authenticated cannot INSERT/UPDATE credit_reservations directly (REVOKE ALL took effect, not just RLS)", async ({
    page,
  }) => {
    const insertAttempt = await supabaseRequest(page, "credit_reservations", {
      method: "POST",
      body: { user_id: "00000000-0000-4000-8000-000000000000", tool: "hack", cost: 1 },
    });
    expect(insertAttempt.status).toBeGreaterThanOrEqual(400);

    const reserved = await reserve(page);
    const updateAttempt = await supabaseRequest(
      page,
      `credit_reservations?id=eq.${reserved!.reservation_id}`,
      { method: "PATCH", body: { status: "consumed" } },
    );
    expect(updateAttempt.status).toBeGreaterThanOrEqual(400);
    // Clean up the reservation this test created via the real RPC path.
    await resolve(page, reserved!.reservation_id!, "refunded");
  });

  test("reconcile_stale_reservations is not callable by authenticated (service_role only)", async ({ page }) => {
    const attempt = await supabaseRequest(page, "rpc/reconcile_stale_reservations", {
      method: "POST",
      body: { p_older_than_minutes: 30 },
    });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
  });

  test("insufficient balance: rejected cleanly, no reservation row, no charge", async ({ page }) => {
    const before = await supabaseRequest(page, "users?select=credits_used,credits_limit", { method: "GET" });
    const { credits_used, credits_limit } = (before.json as Array<{ credits_used: number; credits_limit: number }>)[0];
    const remaining = credits_limit - credits_used;

    const attempt = await reserve(page, remaining + 1000, "qa-e2e-insufficient-probe");
    expect(attempt?.ok).toBe(false);
    expect(attempt?.reservation_id).toBeNull();

    const after = await supabaseRequest(page, "users?select=credits_used", { method: "GET" });
    expect((after.json as Array<{ credits_used: number }>)[0].credits_used).toBe(credits_used);
  });

  test("real concurrency: two simultaneous refund attempts on the same reservation collapse to exactly one refund", async ({
    page,
  }) => {
    const reserved = await reserve(page, 1, "qa-e2e-concurrent-refund");
    const beforeUsed = (
      (await supabaseRequest(page, "users?select=credits_used", { method: "GET" })).json as Array<{
        credits_used: number;
      }>
    )[0].credits_used;

    const [a, b] = await Promise.all([
      resolve(page, reserved!.reservation_id!, "refunded"),
      resolve(page, reserved!.reservation_id!, "refunded"),
    ]);
    const results = [a.json, b.json].map((j) => (Array.isArray(j) ? j[0] : j)) as Array<{
      resolved: boolean;
      final_status: string;
    }>;

    const resolvedCount = results.filter((r) => r.resolved).length;
    expect(resolvedCount).toBe(1);
    expect(results.every((r) => r.final_status === "refunded")).toBe(true);

    const afterUsed = (
      (await supabaseRequest(page, "users?select=credits_used", { method: "GET" })).json as Array<{
        credits_used: number;
      }>
    )[0].credits_used;
    expect(afterUsed).toBe(beforeUsed - 1); // exactly one refund of cost 1, not two
  });

  test("real concurrency: two simultaneous consume attempts on the same reservation collapse to exactly one transition", async ({
    page,
  }) => {
    const reserved = await reserve(page, 1, "qa-e2e-concurrent-consume");

    const [a, b] = await Promise.all([
      resolve(page, reserved!.reservation_id!, "consumed"),
      resolve(page, reserved!.reservation_id!, "consumed"),
    ]);
    const results = [a.json, b.json].map((j) => (Array.isArray(j) ? j[0] : j)) as Array<{
      resolved: boolean;
      final_status: string;
    }>;

    expect(results.filter((r) => r.resolved).length).toBe(1);
    expect(results.every((r) => r.final_status === "consumed")).toBe(true);
  });

  test("real concurrency: consumed and refunded racing on the same reservation — exactly one outcome wins, balance reflects only that one", async ({
    page,
  }) => {
    const reserved = await reserve(page, 1, "qa-e2e-consumed-vs-refunded-race");
    const beforeUsed = (
      (await supabaseRequest(page, "users?select=credits_used", { method: "GET" })).json as Array<{
        credits_used: number;
      }>
    )[0].credits_used;

    const [consumedRes, refundedRes] = await Promise.all([
      resolve(page, reserved!.reservation_id!, "consumed"),
      resolve(page, reserved!.reservation_id!, "refunded"),
    ]);
    const c = (Array.isArray(consumedRes.json) ? consumedRes.json[0] : consumedRes.json) as {
      resolved: boolean;
      final_status: string;
    };
    const r = (Array.isArray(refundedRes.json) ? refundedRes.json[0] : refundedRes.json) as {
      resolved: boolean;
      final_status: string;
    };

    // Exactly one of the two calls actually transitioned the row —
    // regardless of which (that's a timing detail, not a correctness
    // one) — and both calls report the SAME final state, proving there
    // is no window where the row is ambiguously "both".
    const resolvedCount = [c, r].filter((x) => x.resolved).length;
    expect(resolvedCount).toBe(1);
    expect(c.final_status).toBe(r.final_status);
    expect(["consumed", "refunded"]).toContain(c.final_status);

    const afterUsed = (
      (await supabaseRequest(page, "users?select=credits_used", { method: "GET" })).json as Array<{
        credits_used: number;
      }>
    )[0].credits_used;
    // If refunded won, balance goes back down by 1; if consumed won, balance stays (already charged at reserve).
    expect(afterUsed).toBe(c.final_status === "refunded" ? beforeUsed - 1 : beforeUsed);
  });

  test("resolving an already-resolved reservation later is a safe no-op, live", async ({ page }) => {
    const reserved = await reserve(page, 1, "qa-e2e-late-retry");
    await resolve(page, reserved!.reservation_id!, "refunded");
    const retry = await resolve(page, reserved!.reservation_id!, "refunded");
    const retryRow = (Array.isArray(retry.json) ? retry.json[0] : retry.json) as { resolved: boolean };
    expect(retryRow.resolved).toBe(false);
  });

  test("old reserve_credits/refund_credits remain intact and independently callable", async ({ page }) => {
    const oldReserve = await supabaseRequest(page, "rpc/reserve_credits", { method: "POST", body: { p_cost: 1 } });
    expect(oldReserve.status).toBe(200);
    const row = Array.isArray(oldReserve.json) ? oldReserve.json[0] : null;
    expect((row as { ok: boolean } | null)?.ok).toBe(true);
    // Refund it back via the equally-untouched old refund function.
    await supabaseRequest(page, "rpc/refund_credits", { method: "POST", body: { p_cost: 1 } });
  });
});
