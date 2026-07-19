import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility scan (axe-core) on public routes only — no
// authentication happens here. Complements, doesn't replace, the manual
// keyboard-navigation QA already done live on the preview (which is how
// the focus-visible defect fixed in this branch was actually found —
// axe doesn't reliably catch missing focus indicators on its own).
const PUBLIC_ROUTES = ["/", "/auth/login", "/auth/register", "/auth/reset-password", "/legal"];

for (const route of PUBLIC_ROUTES) {
  test(`${route} has no critical/serious axe violations`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const seriousOrWorse = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );

    if (seriousOrWorse.length > 0) {
      const summary = seriousOrWorse
        .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
        .join("\n");
      expect(seriousOrWorse, `Serious/critical a11y violations on ${route}:\n${summary}`).toEqual([]);
    }
  });
}
