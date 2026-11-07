import { test, expect } from "@playwright/test";

// The server picks the interface language per request (frontend/src/i18n/request.ts):
// the LITT_LOCALE cookie, then Accept-Language, then es-MX. The page title is
// the catalog's common.meta.title, so it shows which catalog was served. No
// screen is translated yet; the rest of the UI stays English until its card.
// Every /api call is mocked: this spec needs no backend (synthetic project).

const TITLE = { "es-MX": "LiTT - Plataforma legal con IA", "en-US": "LiTT - Legal AI Platform" };

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not signed in" } }));
});

test("the es-MX cookie serves the Spanish catalog over an English browser", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "LITT_LOCALE", value: "es-MX", url: baseURL! }]);
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "es-MX");
    await expect(page).toHaveTitle(TITLE["es-MX"]);
});

test("without a cookie the browser language decides, by quality", async ({ page, request }) => {
    // Playwright's locale (playwright.config.ts) sends Accept-Language en-US.
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page).toHaveTitle(TITLE["en-US"]);

    const preferred = await request.get("/login", { headers: { "Accept-Language": "en;q=0.2, es-ES;q=0.9" } });
    expect(await preferred.text()).toContain('<html lang="es-MX"');
});

test("a language LiTT does not offer falls back to es-MX", async ({ request }) => {
    const html = await (await request.get("/login", { headers: { "Accept-Language": "de-DE,fr;q=0.8" } })).text();
    expect(html).toContain('<html lang="es-MX"');
    expect(html).toContain(`<title>${TITLE["es-MX"]}</title>`);
});
