import { defineConfig } from "@playwright/test";

// E2E/responsive/accessibility QA against the deployed preview Worker —
// not a local dev server. This exists specifically because the browser
// automation tool available in this environment can't reliably emulate
// viewport widths (only height), so real responsive verification needs
// Playwright's own viewport emulation instead. Public routes only: this
// suite never authenticates (see e2e/README.md for why).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 1,
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "https://lostykk-postulpro-preview.ignacioo-ch13.workers.dev",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
