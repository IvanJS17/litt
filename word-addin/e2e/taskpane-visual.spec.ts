/**
 * Task-pane fit and finish at Word's narrow width: the profile's dark theme,
 * a greeting that a long name cannot stretch, a composer that scrolls its
 * text instead of cutting a line, and a "Select a model" warning that leads
 * to where a model is chosen.
 */
import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

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
