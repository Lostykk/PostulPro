import { test, expect } from "@playwright/test";

// Public routes only — no authentication happens anywhere in this file.
// Representative viewport set spanning small/modern mobile, tablet,
// laptop and large desktop (the redesign brief's own guidance: no need
// to hit all 10 requested sizes per route, just cover each device
// class).
const VIEWPORTS = [
  { name: "mobile-small", width: 375, height: 667 },
  { name: "mobile-modern", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop-large", width: 1920, height: 1080 },
];

const PUBLIC_ROUTES = ["/", "/auth/login", "/auth/register", "/auth/reset-password", "/legal", "/demo"];

for (const viewport of VIEWPORTS) {
  test.describe(`viewport: ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const route of PUBLIC_ROUTES) {
      test(`${route} has no horizontal overflow`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("networkidle");

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
          };
        });

        // Allow a 1px rounding tolerance (subpixel layout is normal).
        expect(
          overflow.scrollWidth,
          `document.scrollWidth (${overflow.scrollWidth}) should not exceed clientWidth (${overflow.clientWidth}) at ${viewport.width}px`,
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      });
    }
  });
}

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("hamburger menu opens and exposes the primary CTA within the viewport", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // At this width the desktop nav+CTA row is hidden (md:flex) in favor
    // of a hamburger toggle — the CTA only becomes reachable once opened.
    const toggle = page.getByRole("button", { name: /abrir menú/i });
    await expect(toggle).toBeVisible();
    await toggle.click();

    const cta = page.getByRole("link", { name: /comenzar gratis/i });
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1);
  });
});
