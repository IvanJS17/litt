/**
 * The pane's interface language (plan i18n §2.4):
 *   1. the profile's ui_locale, once signed in;
 *   2. the language picked on this device (localStorage `litt.locale`);
 *   3. Word's displayLanguage, mapped to es-MX or en-US;
 *   4. es-MX.
 * The Office shim reports en-US unless a spec seeds another displayLanguage,
 * which is why every other spec still sees English.
 */
import { test, expect } from "./support/fixtures";

const TOKEN = "locale-token";

test.describe("before sign-in", () => {
  test("follows Word's display language: Spanish for es-ES", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane({ displayLanguage: "es-ES" });
    await expect(
      page.getByRole("heading", { name: "Iniciar sesión" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continuar con Google" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Regístrate" })).toBeVisible();
  });

  test("follows Word's display language: English for en-GB", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane({ displayLanguage: "en-GB" });
    await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
  });

  test("an unsupported Word language falls back to es-MX", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane({ displayLanguage: "fr-FR" });
    await expect(
      page.getByRole("heading", { name: "Iniciar sesión" }),
    ).toBeVisible();
  });

  test("the login selector changes the language in place and is remembered", async ({
    addin,
    page,
  }) => {
    await addin.gotoTaskpane({ displayLanguage: "es-ES" });
    // A marker only a reload would lose.
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });
    await page
      .getByRole("combobox", { name: "Idioma de la interfaz" })
      .selectOption("en-US");
    await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as unknown as { __noReload?: boolean }).__noReload,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.localStorage.getItem("litt.locale")),
    ).toBe("en-US");

    // The next open starts where the user left it, whatever Word says.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
  });
});

test.describe("signed in", () => {
  test("the profile's ui_locale wins over Word's language", async ({
    addin,
    page,
  }) => {
    await page.route("**/user/profile", (route, request) => {
      if (request.method() !== "GET") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          displayName: "Test User",
          uiLocale: "es-MX",
          lastSelectedChatModel: "gemini-3-flash-preview",
          lastSelectedReasoningLevel: "high",
          openRouterModels: [],
          vercelModels: [],
          openCodeGoModels: [],
        }),
      });
    });
    await addin.gotoTaskpane({ token: TOKEN, displayLanguage: "en-US" });
    await addin.expectAuthedShell();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByText("Ajustes", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Idioma de la interfaz" }),
    ).toHaveValue("es-MX");
  });

  test("the Settings selector saves ui_locale in the profile and switches without reloading", async ({
    addin,
    page,
  }) => {
    const saved: unknown[] = [];
    await page.route("**/user/profile", (route, request) => {
      if (request.method() !== "PATCH") return route.fallback();
      saved.push(request.postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ uiLocale: "es-MX" }),
      });
    });
    await addin.gotoTaskpane({ token: TOKEN });
    await addin.expectAuthedShell();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByText("Settings", { exact: true })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    await page
      .getByRole("combobox", { name: "Interface language" })
      .selectOption("es-MX");

    await expect(page.getByText("Ajustes", { exact: true })).toBeVisible();
    expect(saved).toEqual([{ uiLocale: "es-MX" }]);
    expect(
      await page.evaluate(
        () => (window as unknown as { __noReload?: boolean }).__noReload,
      ),
    ).toBe(true);
  });

  test("a profile that cannot be saved keeps the current language and says so", async ({
    addin,
    page,
  }) => {
    await page.route("**/user/profile", (route, request) => {
      if (request.method() !== "PATCH") return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "boom" }),
      });
    });
    await addin.gotoTaskpane({ token: TOKEN });
    await addin.expectAuthedShell();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page
      .getByRole("combobox", { name: "Interface language" })
      .selectOption("es-MX");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Interface language" }),
    ).toHaveValue("en-US");
  });
});
