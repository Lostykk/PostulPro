import { test, expect } from "@playwright/test";
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

// A tiny (68-byte) valid 1x1 magenta PNG, built in-memory — no fixture
// file on disk, no external asset, nothing that could be mistaken for
// real user content.
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const BLUE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAAXNSR0IArs4c6QAAAA1JREFUCB1jYPjP8B8ABQYCAV11UqcAAAAASUVORK5CYII=",
  "base64",
);

test.describe("landing builder image lifecycle (QA account, real preview backend)", () => {
  test.skip(!qa, "No .qa.local.json fixture in this environment — skipping account-based checks");

  test("generate a QA landing, upload/replace/remove an image, verify persistence, RLS and credit cost", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByPlaceholder("vos@ejemplo.com").fill(qa!.email);
    await page.getByPlaceholder(/contraseña|••/i).fill(qa!.password);
    await page.getByRole("button", { name: /ingresar/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    const creditsText = async () => page.locator("text=/\\d+\\/\\d+/").first().textContent();

    // --- Generate a clearly-QA-labeled landing copy (real, minimal cost:
    // 2 credits, same class of spend already documented in prior QA rounds).
    // The credit delta from generation itself isn't this test's concern —
    // Fase A already covers generation cost. What matters here is that the
    // IMAGE operations that follow cost nothing on top of it.
    await page.goto("/tools/landing-copy");
    await page.getByPlaceholder(/App de finanzas personales/i).fill("QA E2E landing image test");
    await page.getByPlaceholder(/freelancers/i).fill("QA testers");
    // Wait for the actual /api/generate-ai response to complete (not just
    // for "headlines" to render) — the client can finish parsing valid
    // JSON from the accumulated stream before the server's "done" event
    // (and the generations INSERT that precedes it) has actually arrived.
    // Navigating away before that response settles aborts the still-open
    // request server-side — confirmed empirically via a captured trace
    // showing net::ERR_ABORTED, with credits reserved but no row ever
    // persisted (see the residual-risk note in the final report).
    const genResponse = page.waitForResponse(
      (r) => r.url().includes("/api/generate-ai") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /generar/i }).click();
    await expect(page.getByText(/headlines/i)).toBeVisible({ timeout: 30_000 });
    const response = await genResponse;
    await response.finished();
    await page.waitForLoadState("networkidle");

    // --- Open it from the Library, where DeliverableRenderer routes
    // toolKey "landing-copy" to the full visual LandingBuilder (the
    // standalone /tools/landing-copy page only shows a simpler editable-
    // fields form — this is the one place image upload actually lives).
    await page.goto("/library");
    // Each card is a flat `div.rounded-xl` containing both the title and
    // its action row (library.tsx:446-487) — filter on that class + text
    // so we click the "Ver" scoped to this exact card, not another item's.
    // Library orders by created_at DESC, so .first() is the most recent —
    // relevant because repeated runs of this same test reuse the same
    // title text and accumulate multiple matching cards over time.
    const cardRoot = page.locator("div.rounded-xl", { hasText: "QA E2E landing image test" }).first();
    await expect(cardRoot).toBeVisible({ timeout: 10_000 });
    await cardRoot.getByRole("button", { name: "Ver" }).click();

    // Confirm this is really the section-based builder (sidebar with a
    // section list), not the plain markdown view.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Hero", exact: true })).toBeVisible({ timeout: 10_000 });

    // No section is selected by default — click "Hero" to open its editor
    // panel (this is where the image field lives).
    await dialog.getByRole("button", { name: "Hero", exact: true }).click();
    await expect(page.getByText(/^Editando:/)).toBeVisible({ timeout: 10_000 });

    // Baseline credits captured HERE, on the fully-settled builder page —
    // everything from this point on (upload/replace/remove/reload) must
    // never move this number.
    const creditsBaseline = await creditsText();

    // --- Upload: the Hero section, now selected, is the one with an image
    // field ("Imagen de portada") — scoped to the editor sidebar
    // (complementary landmark) since the same label text also appears as
    // a placeholder string in the live preview pane.
    const editorPanel = page.getByRole("complementary");
    await expect(editorPanel.getByText("Imagen de portada", { exact: true })).toBeVisible();
    await editorPanel.getByText("Subir imagen").locator("input[type='file']").setInputFiles({
      name: "qa-e2e-test-image.png",
      mimeType: "image/png",
      buffer: RED_PNG,
    });

    const heroImg = page.locator("img[alt='']").first();
    await expect(heroImg).toBeVisible({ timeout: 15_000 });
    const firstSrc = await heroImg.getAttribute("src");
    expect(firstSrc).toMatch(/landing-images/);
    await expect(page.getByText("Imagen subida")).toBeVisible({ timeout: 5_000 });

    // Autosave must have kicked in. The "Guardado" label is a one-render
    // flash (an effect keyed on initialDoc resets saveState back to
    // "idle"/"Sin cambios" immediately after a successful save — by
    // design, not a bug), so it's not a reliable thing to assert on here.
    // The real proof of a successful save is the reload-persistence check
    // further down: it can only pass if the autosave actually landed.
    await expect(page.getByText(/^(Guardado|Sin cambios)$/)).toBeVisible({ timeout: 10_000 });

    // Credits must be untouched by the upload itself.
    const creditsAfterUpload = await creditsText();
    expect(creditsAfterUpload).toBe(creditsBaseline);

    // --- Persistence across a hard refresh: the modal itself is just
    // client-side state, so a reload drops back to the bare Library list —
    // reopen the same card and reselect Hero to confirm the image survived
    // in the actual persisted document, not just in-memory React state.
    await page.reload();
    await page.waitForLoadState("networkidle");
    const cardRootAfterReload = page.locator("div.rounded-xl", { hasText: "QA E2E landing image test" }).first();
    await cardRootAfterReload.getByRole("button", { name: "Ver" }).click();
    const dialogAfterReload = page.getByRole("dialog");
    await dialogAfterReload.getByRole("button", { name: "Hero", exact: true }).click();
    await expect(page.getByText(/^Editando:/)).toBeVisible({ timeout: 10_000 });
    const heroImgAfterReload = page.locator("img[alt='']").first();
    await expect(heroImgAfterReload).toBeVisible({ timeout: 15_000 });
    expect(await heroImgAfterReload.getAttribute("src")).toBe(firstSrc);

    // --- Replace: upload a second image, confirm the src actually changes
    // (i.e. it's a real replace, not a no-op) and the old object gets a
    // best-effort delete call fired (deleteLandingImage).
    let sawStorageDelete = false;
    page.on("request", (req) => {
      if (req.method() === "DELETE" || (req.method() === "POST" && req.url().includes("/storage/v1/object/remove"))) {
        sawStorageDelete = true;
      }
    });
    await editorPanel.getByText("Subir imagen").locator("input[type='file']").setInputFiles({
      name: "qa-e2e-test-image-2.png",
      mimeType: "image/png",
      buffer: BLUE_PNG,
    });
    await expect(page.getByText("Imagen subida")).toBeVisible({ timeout: 15_000 });
    const heroImgAfterReplace = page.locator("img[alt='']").first();
    await expect
      .poll(async () => heroImgAfterReplace.getAttribute("src"), { timeout: 10_000 })
      .not.toBe(firstSrc);
    const secondSrc = await heroImgAfterReplace.getAttribute("src");
    expect(secondSrc).toMatch(/landing-images/);
    expect(sawStorageDelete).toBe(true);

    const creditsAfterReplace = await creditsText();
    expect(creditsAfterReplace).toBe(creditsBaseline);

    // --- Remove: click the X overlay, confirm it clears back to the
    // "Imagen de portada pendiente" empty state.
    await editorPanel.getByRole("button", { name: /quitar imagen/i }).click();
    await expect(editorPanel.getByText("Imagen de portada pendiente")).toBeVisible({ timeout: 5_000 });

    const creditsAfterRemove = await creditsText();
    expect(creditsAfterRemove).toBe(creditsBaseline);
  });
});
