import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

// The public start page (`/`): the same page with or without a session, nothing
// to sign in for, no horizontal scroll on a phone, and the checks Google's
// verification looks at. Every /api call is mocked: this spec needs no backend
// (synthetic project). The page itself calls no API; a session is only a cookie.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not signed in" } }));
});

async function setUp(page: Page, opts: { locale: "es-MX" | "en-US"; theme: "light" | "dark"; session?: boolean }) {
    const { baseURL } = test.info().project.use;
    const url = baseURL ?? "http://localhost:3000";
    const cookies: { name: string; value: string; url: string }[] = [{ name: "LITT_LOCALE", value: opts.locale, url }];
    if (opts.session) cookies.push({ name: "mike-session", value: "x", url });
    await page.context().addCookies(cookies);
    await page.addInitScript((theme) => window.localStorage.setItem("litt:theme", theme), opts.theme);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // The stored theme is applied after hydration and its pill animates for
    // 150 ms; wait for it to settle so contrast checks never read a mid-transition color.
    await expect(page.locator(`[data-theme-option="${opts.theme}"][aria-checked="true"]`)).toBeAttached();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

test("a visitor gets the page: LiTT, the privacy notice and the terms, in the HTML", async ({ request }) => {
    const response = await request.get("/", { headers: { "Accept-Language": "es-MX" } });
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("LiTT es un asistente jurídico con IA");
    expect(html).toMatch(/<a [^>]*href="\/privacidad"[^>]*>[^<]*Aviso de privacidad/);
    expect(html).toMatch(/<a [^>]*href="\/terminos"[^>]*>[^<]*Términos y condiciones/);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="/assistant"');
});

test("with a session cookie the button says «Open LiTT» and goes to /assistant, from the first byte", async ({ request, baseURL }) => {
    const response = await request.get("/", { headers: { cookie: "mike-session=x", "Accept-Language": "en-US" } });
    const html = await response.text();
    expect(html.match(/href="\/assistant"/g)).toHaveLength(3);
    expect(html).not.toContain('href="/login"');
    expect(html).toContain("Open LiTT");
    expect(baseURL).toBeTruthy();
});

test("does not redirect a visitor and does not ask who is signed in", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => r.url().includes("/api/") && calls.push(r.url()));
    await setUp(page, { locale: "en-US", theme: "light" });
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");
    expect(calls).toEqual([]);
});

for (const locale of ["es-MX", "en-US"] as const) {
    for (const theme of ["light", "dark"] as const) {
        test(`a 390 × 844 phone never scrolls sideways, and axe finds nothing (${locale}, ${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await setUp(page, { locale, theme });
            await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark).*$/);
            const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
            expect(widths[0]).toBeLessThanOrEqual(widths[1]);

            const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
            expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        });
    }
}

test("the header's button docks only once the hero's buttons leave the screen", async ({ page }) => {
    await setUp(page, { locale: "en-US", theme: "light" });
    const header = page.getByRole("banner").getByRole("link", { name: "Sign in" });
    await expect(header).toHaveAttribute("inert", "");
    await page.getByRole("heading", { name: "We’re opening beta seats a few at a time." }).scrollIntoViewIfNeeded();
    await expect(header).not.toHaveAttribute("inert", "");
    await expect(header).toBeVisible();
});

test("a citation shows its source, and the table scrolls inside its sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setUp(page, { locale: "en-US", theme: "light" });
    await page.getByRole("button", { name: "Citation 2", exact: true }).click();
    await expect(page.locator("#landing-source")).toContainText("p. 9");
    const region = page.getByRole("region", { name: "Tabular review example" });
    await region.scrollIntoViewIfNeeded();
    const [scrollWidth, clientWidth] = await region.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
});

test("with reduced motion nothing plays: the verification is already complete", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setUp(page, { locale: "en-US", theme: "light" });
    await expect(page.locator("#landing-source")).toContainText("Citation verified");
    await expect(page.locator(".landing-spinner")).toHaveCount(0);
    const motion = await page.evaluate(() =>
        [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    );
    expect(motion).toBe(0);
});

test("the verification plays once per browser session", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.removeItem("litt:landing-intro"));
    await setUp(page, { locale: "en-US", theme: "light" });
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("litt:landing-intro"))).toBe("1");
    await expect(page.locator("#landing-source")).toContainText("Citation verified", { timeout: 5_000 });
});

test("the language and the theme can be changed from the footer", async ({ page }) => {
    await setUp(page, { locale: "es-MX", theme: "light" });
    await page.getByRole("radio", { name: "Oscuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What LiTT tells you, you can check.");
});
