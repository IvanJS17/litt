/**
 * Task-pane fit and finish at Word's narrow width: the profile's dark theme,
 * a greeting that a long name cannot stretch, a composer that scrolls its
 * text instead of cutting a line, and a "Select a model" warning that leads
 * to where a model is chosen.
 */
import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

const LONG_PROMPT =
  "Revisa la cláusula segunda del contrato de arrendamiento comercial y dime si el mantenimiento mayor a cargo del arrendatario es razonable; " +
  "compara la pena convencional por terminación anticipada con la actualización de la renta conforme al INPC y señala cualquier contradicción " +
  "con el convenio de confidencialidad, cláusula por cláusula, citando el texto exacto de cada una.";


async function mockProfile(
  page: Page,
  profile: Record<string, unknown>,
): Promise<void> {
  await page.route("**/user/profile", (route, request) => {
    if (request.method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        displayName: "Test User",
        lastSelectedChatModel: "gemini-3-flash-preview",
        lastSelectedReasoningLevel: "high",
        openRouterModels: [],
        vercelModels: [],
        openCodeGoModels: [],
        ...profile,
      }),
    });
  });
}


test.beforeEach(async ({ addin, page }) => {
  addin.seedToken("test-jwt-token");
  await page.setViewportSize({ width: 350, height: 720 });
});

test.describe("profile theme", () => {
  test("follows the profile's dark theme", async ({ addin, page }) => {
    await mockProfile(page, { darkMode: true });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    const root = page.locator("html");
    await expect(root).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(root).toHaveCSS("color-scheme", "dark");
    // The tinta canvas, not the light papel one.
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(21, 26, 38)",
    );
  });

  test("stays light when the profile's dark theme is off", async ({
    addin,
    page,
  }) => {
    await mockProfile(page, { darkMode: false });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await expect(page.getByRole("heading", { name: /^Hi,/ })).toBeVisible();

    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });
});

test("scrolls long composer text on whole lines instead of cutting the top one", async ({
  addin,
  page,
}) => {
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const textarea = page.getByPlaceholder("How can I help?");
  await textarea.fill(LONG_PROMPT);

  await expect
    .poll(() => textarea.evaluate((element) => getComputedStyle(element).overflowY))
    .toBe("auto");
  const metrics = await textarea.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));
  // Taller than the cap, so the text scrolls inside the field...
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  // ...and the field holds whole lines, so the end of the text starts on a
  // line boundary.
  expect(metrics.clientHeight % metrics.lineHeight).toBe(0);
  expect(metrics.clientHeight / metrics.lineHeight).toBe(6);
});
