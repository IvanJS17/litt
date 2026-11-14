/**
 * Task-pane fit and finish at Word's narrow width: the profile's dark theme,
 * a greeting that a long name cannot stretch, a composer that scrolls its
 * text instead of cutting a line, and a "Select a model" warning that leads
 * to where a model is chosen.
 */
import { test, expect } from "./support/fixtures";
import type { Page } from "@playwright/test";

const LONG_NAME = "Alejandra Montserrat Villaseñor Castañeda";

const LONG_PROMPT =
  "Revisa la cláusula segunda del contrato de arrendamiento comercial y dime si el mantenimiento mayor a cargo del arrendatario es razonable; " +
  "compara la pena convencional por terminación anticipada con la actualización de la renta conforme al INPC y señala cualquier contradicción " +
  "con el convenio de confidencialidad, cláusula por cláusula, citando el texto exacto de cada una.";

const noneConfigured = {
  claude: false,
  gemini: false,
  openai: false,
  openrouter: false,
  sources: { claude: null, gemini: null, openai: null, openrouter: null },
};

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

/** Record what the pane hands to the browser instead of opening it. */
async function recordOpenedUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as unknown as { __openedUrls: string[] }).__openedUrls = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return {} as Window;
    }) as typeof window.open;
  });
}

test.beforeEach(async ({ addin, page }) => {
  addin.seedToken("test-jwt-token");
  await page.setViewportSize({ width: 350, height: 720 });
});

test.describe("profile theme", () => {
  test("follows the profile's dark theme", async ({ addin, page }) => {
    await mockProfile(page, { theme: "dark" });
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
    await mockProfile(page, { theme: "light" });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await expect(page.getByRole("heading", { name: /^Hi,/ })).toBeVisible();

    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("Automático follows the device, and changes with it", async ({
    addin,
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockProfile(page, { theme: "system" });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();

    const root = page.locator("html");
    await expect(root).toHaveClass(/(^|\s)dark(\s|$)/);

    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("a chosen light theme ignores a dark device", async ({ addin, page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockProfile(page, { theme: "light" });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });
});

test("greets by first name so a long name keeps to one line", async ({
  addin,
  page,
}) => {
  await mockProfile(page, { displayName: LONG_NAME });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const greeting = page.getByRole("heading", {
    name: "Hi, Alejandra",
    exact: true,
  });
  await expect(greeting).toBeVisible();
  const lines = await greeting.evaluate((element) => {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return Math.round(element.getBoundingClientRect().height / lineHeight);
  });
  expect(lines).toBe(1);
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

test.describe("Select a model warning", () => {
  test("opens the model picker when there are models to choose", async ({
    addin,
    page,
  }) => {
    await mockProfile(page, { lastSelectedChatModel: null });
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    // At pane width the picker is an icon button; nothing is selected yet.
    await expect(
      page.getByRole("button", { name: "Choose model" }),
    ).toHaveAttribute("aria-expanded", "false");

    await page.getByPlaceholder("How can I help?").fill("Hola");
    await page.getByRole("button", { name: "Send message" }).click();

    const warning = page.getByRole("alert");
    await expect(warning).toContainText(
      "Select a model before sending your message.",
    );
    await warning.getByRole("button", { name: "Choose model" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
  });

  test("links to My AI keys when there are no models", async ({
    addin,
    page,
  }) => {
    await recordOpenedUrls(page);
    await mockProfile(page, { lastSelectedChatModel: null });
    await addin.mockApiJson("GET", "**/user/api-keys", noneConfigured);
    await addin.gotoTaskpane();
    await addin.expectAuthedShell();
    await expect(
      page.getByRole("button", { name: "No models available" }),
    ).toBeVisible();

    await page.getByPlaceholder("How can I help?").fill("Hola");
    await page.getByRole("button", { name: "Send message" }).click();

    const warning = page.getByRole("alert");
    await expect(warning).toContainText(
      "Select a model before sending your message.",
    );
    await warning
      .getByRole("button", { name: "Open My AI keys" })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
        ),
      )
      .toEqual(["http://localhost:3000/settings/byok"]);
  });
});
