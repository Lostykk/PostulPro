import { defineConfig } from "@playwright/test";

// E2E/responsive/accessibility QA against the deployed preview Worker —
// not a local dev server. This exists specifically because the browser
// automation tool available in this environment can't reliably emulate
// viewport widths (only height), so real responsive verification needs
// Playwright's own viewport emulation instead.
//
// workers: 1 — several specs (auth-flow, landing-images, permissions-rls)
// log in as the SAME single QA fixture account (there is only one; this
// suite never creates new accounts). Running them in parallel workers
// causes real session/timing contention against that one shared account
// (confirmed: landing-images failed only when run alongside other
// account-based specs, passed cleanly every time in isolation) — this
// isn't a product bug, it's this suite's own account being shared, so
// sequential execution is the correct fix rather than chasing flakiness.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
