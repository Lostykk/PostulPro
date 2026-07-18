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

// These tests call the Supabase REST/RPC API directly with the QA
// account's own session token, bypassing the app's UI entirely — this is
// what actually proves an RLS/grant boundary holds, as opposed to a
// button just being hidden in the frontend. Everything needed to do this
// (project URL, publishable/anon key, the user's own already-issued
// session token) is information the browser's Network tab already shows
// to anyone using the app normally — none of it is a secret, and no
// value is ever printed here.
async function supabaseRequest(
  page: Page,
  pathAndQuery: string,
  init: { method: string; body?: unknown },
) {
  return page.evaluate(
    async ({ pathAndQuery, init }) => {
      const raw = Object.keys(window.localStorage)
        .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
        .map((k) => window.localStorage.getItem(k))
        .find(Boolean);
      if (!raw) throw new Error("No Supabase session found in localStorage");
      const session = JSON.parse(raw as string);
      const accessToken = session.access_token as string;
      // Injected by the test's beforeEach via addInitScript — the
      // publishable key is public/non-secret (identical to what every
      // request the app itself already sends as `apikey`), so this is
      // just avoiding a network round-trip to rediscover it per test.
      const apikey = (window as unknown as { __qaSbApiKey?: string }).__qaSbApiKey;
      if (!apikey) throw new Error("No Supabase publishable key available in page context");

      const res = await fetch(`https://ccpejnklrfvgtwryqfrw.supabase.co/rest/v1/${pathAndQuery}`, {
        method: init.method,
        headers: {
          "Content-Type": "application/json",
          apikey,
          Authorization: `Bearer ${accessToken}`,
          Prefer: init.method === "POST" ? "return=representation" : "return=minimal",
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

test.describe("non-admin permission boundaries (QA account, real preview backend)", () => {
  test.skip(!qa, "No .qa.local.json fixture in this environment — skipping account-based checks");

  test.beforeEach(async ({ page }) => {
    // Inject the publishable key (public, non-secret — visible in every
    // request the app itself already makes) before navigation so the
    // in-page fetch helper above can use it without importing app source,
    // which only resolves against Vite's dev server, not this deployed
    // production build.
    await page.addInitScript(() => {
      (window as unknown as { __qaSbApiKey?: string }).__qaSbApiKey =
        "sb_publishable_PXzGESMpOsoeDZPb8JKPqQ_wRTHTCPs";
    });
  });

  test("logged-in non-admin visiting /marketplace is bounced to /dashboard, not shown the UI", async ({ page }) => {
    await login(page);
    await page.goto("/marketplace");
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("cannot read another user's row via a guessed/random id (RLS-scoped SELECT)", async ({ page }) => {
    await login(page);
    const result = await supabaseRequest(
      page,
      "ai_projects?id=eq.00000000-0000-4000-8000-000000000000&select=id,user_id,title",
      { method: "GET" },
    );
    expect(result.status).toBe(200);
    expect(result.json).toEqual([]);
  });

  test("cannot self-escalate plan/role via a direct table UPDATE (column-level grant, not just RLS)", async ({ page }) => {
    await login(page);
    const result = await supabaseRequest(page, "users?select=plan,role", {
      method: "PATCH",
      body: { plan: "business", role: "admin" },
    });
    // PostgreSQL must reject this outright (permission denied for column)
    // rather than silently applying it — 40x, never 200 with the
    // escalated values reflected back.
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test("cannot write to user_roles at all (no INSERT grant for authenticated)", async ({ page }) => {
    await login(page);
    const uidResult = await page.evaluate(() => {
      const raw = Object.keys(window.localStorage)
        .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
        .map((k) => window.localStorage.getItem(k))
        .find(Boolean);
      return raw ? JSON.parse(raw).user?.id : null;
    });
    const result = await supabaseRequest(page, "user_roles", {
      method: "POST",
      body: { user_id: uidResult, role: "admin" },
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  test("admin_update_user_plan RPC rejects a non-admin caller server-side", async ({ page }) => {
    await login(page);
    const uidResult = await page.evaluate(() => {
      const raw = Object.keys(window.localStorage)
        .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
        .map((k) => window.localStorage.getItem(k))
        .find(Boolean);
      return raw ? JSON.parse(raw).user?.id : null;
    });
    const result = await supabaseRequest(page, "rpc/admin_update_user_plan", {
      method: "POST",
      body: { p_target_user_id: uidResult, p_new_plan: "business" },
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(result.json)).toMatch(/unauthorized|admin role required/i);
  });

  test("generate_api_key RPC rejects a non-BUSINESS caller server-side", async ({ page }) => {
    await login(page);
    const result = await supabaseRequest(page, "rpc/generate_api_key", {
      method: "POST",
      body: { p_name: "qa-e2e-rls-probe" },
    });
    // The QA fixture account is plan PRO, not BUSINESS.
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(result.json)).toMatch(/business/i);
  });
});
