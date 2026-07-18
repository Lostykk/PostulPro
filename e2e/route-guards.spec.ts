import { test, expect } from "@playwright/test";

// Verifies the unauthenticated boundary of every route under
// /_authenticated (src/routes/_authenticated/route.tsx): beforeLoad
// checks supabase.auth.getUser() client-side (ssr: false) and redirects
// to /auth/login when there's no session. This never logs in as
// anyone — it only confirms that NOT being logged in correctly blocks
// access, which is the one authorization boundary testable without
// entering any credentials.
const PROTECTED_ROUTES = [
  "/dashboard",
  "/build",
  "/projects",
  "/library",
  "/settings",
  "/admin",
  "/affiliates",
  "/tools",
  "/tools/copywriter",
  "/marketplace",
];

test.describe("unauthenticated access to protected routes", () => {
  // Fresh, cookie-less context per test (Playwright's default) — no
  // session exists, so every one of these should bounce to login.
  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to /auth/login when logged out`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });
      expect(page.url()).toContain("/auth/login");
    });
  }
});
