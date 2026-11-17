import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

// The public start page (`/`): the same page with or without a session, nothing
// to sign in for, no horizontal scroll on a phone, the phone menu (SPEC v2 §2.3
// and §2.4), and the checks Google's verification looks at. Every /api call is mocked: this spec needs no backend
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
    // (The phone menu's group carries the attribute, hidden or not.)
    await expect(page.locator(`[data-theme-option="${opts.theme}"][aria-checked="true"]`).first()).toBeAttached();
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
    // The assistant's steps come in once per session, over about two seconds, with
    // pauses between them: wait until the last is in place and nothing is pending.
    await expect(page.locator("[data-intro]")).toHaveCount(0, { timeout: 8_000 });
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
    // The header's docked button, the phone menu's (closed, in the HTML), the hero's and QUINTO's.
    expect(html.match(/href="\/assistant"/g)).toHaveLength(4);
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

test("every way into the beta opens the Tally questionnaire with its origin and the page's language", async ({ page }) => {
    await setUp(page, { locale: "es-MX", theme: "light" });
    const form = "https://tally.so/r/2jAeGL";
    // The page sends nothing to Tally by itself: these are plain links, the same tab, with a safe rel.
    for (const link of await page.getByRole("link", { name: "Solicitar acceso" }).all()) {
        await expect(link).toHaveAttribute("href", `${form}?origen=acceso&lang=es-MX`);
        await expect(link).toHaveAttribute("rel", "noopener noreferrer");
        await expect(link).not.toHaveAttribute("target", /.+/);
    }
    const soon = page.locator("#proximamente");
    await expect(soon.getByRole("link", { name: "Únete a la lista de espera" })).toHaveAttribute(
        "href",
        `${form}?origen=inhouse&lang=es-MX`,
    );
    const origins = await soon
        .getByRole("link", { name: /^Me interesa/ })
        .evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("origen")));
    expect(origins).toEqual(["soon-contextlex", "soon-mcp", "soon-donna", "soon-conectores"]);
    // The support address is still a plain contact link in the footer.
    await expect(page.getByRole("contentinfo").locator('a[href="mailto:soporte@asteroitt.com"]')).toHaveCount(1);
    // Honest copy: the footnotes are there and Donna is never sold by the hour.
    await expect(soon).toContainText("* Google en preparación; Microsoft 365 y Dropbox en diseño.");
    await expect(soon).toContainText("* Harness: el programa con el que trabajas con una IA");
    expect((await soon.textContent()) ?? "").not.toMatch(/\bhoras?\b/i);
});

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
    await page.getByRole("button", { name: "Citation 3", exact: true }).click();
    await expect(page.locator("#landing-source")).toContainText("p. 9");
    const region = page.getByRole("region", { name: "Tabular review example" });
    await region.scrollIntoViewIfNeeded();
    const [scrollWidth, clientWidth] = await region.evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
});

test("with reduced motion nothing plays: the steps are all there from the first frame", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setUp(page, { locale: "en-US", theme: "light" });
    await expect(page.locator("#landing-source")).toContainText("Citation verified");
    await expect(page.locator("[data-intro]")).toHaveCount(0);
    const motion = await page.evaluate(() =>
        [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    );
    expect(motion).toBe(0);
    await expect(page.getByText("Finished in 4 steps")).toBeVisible();
});

test("the assistant's steps come in once per browser session, and all of them stay", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.removeItem("litt:landing-intro"));
    await setUp(page, { locale: "en-US", theme: "light" });
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("litt:landing-intro"))).toBe("1");
    // About two seconds later nothing is waiting to come in, and everything is visible.
    await expect(page.locator("[data-intro]")).toHaveCount(0, { timeout: 6_000 });
    await expect(page.getByText("Drafted Demand letter.docx")).toBeVisible();
    await expect(page.getByText("2 pages · new in the project")).toBeVisible();
});

test("the theme changes from the header icon and the language from the footer, which has no theme group", async ({ page }) => {
    await setUp(page, { locale: "es-MX", theme: "light" });
    await expect(page.locator("footer").getByRole("radiogroup", { name: "Tema" })).toHaveCount(0);
    await page.getByRole("button", { name: "Cambiar a tema oscuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.locator("footer").getByRole("radio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The legal assistant that works the matter with you.");
});

test("an old link to #que-hace lands on #funciones", async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto("/#que-hace");
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#funciones");
});

// ── The phone menu (SPEC v2 §2.3, tests of §2.4) ──

const PHONE = { width: 390, height: 844 };

async function onAPhone(page: Page, opts: { locale?: "es-MX" | "en-US"; theme?: "light" | "dark"; size?: { width: number; height: number } } = {}) {
    await page.setViewportSize(opts.size ?? PHONE);
    await setUp(page, { locale: opts.locale ?? "en-US", theme: opts.theme ?? "light" });
    // The button needs JavaScript: it appears when the page has hydrated.
    await expect(page.getByRole("button", { name: opts.locale === "es-MX" ? "Menú" : "Menu" })).toBeVisible();
}

test("the menu button shows on 390 × 844 and 375 × 667, closed, and not at 1000 px", async ({ page }) => {
    for (const size of [PHONE, { width: 375, height: 667 }]) {
        await onAPhone(page, { size });
        const button = page.getByRole("button", { name: "Menu" });
        await expect(button).toHaveAttribute("aria-expanded", "false");
        await expect(button).toHaveAttribute("aria-controls", "landing-menu");
        const box = await button.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator("#landing-menu")).toBeHidden();
    }
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    // From 880 px the four links are in the header itself.
    const nav = page.getByRole("banner").getByRole("navigation", { name: "Sections" });
    await expect(nav.getByRole("link")).toHaveText(["Features", "Why LiTT", "Coming soon", "Trust"]);
});

test("opening the menu moves the focus to «Features», makes the page inert and stops the page scrolling", async ({ page }) => {
    await onAPhone(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#landing-menu").getByRole("link", { name: "Features" })).toBeFocused();
    const state = await page.evaluate(() => ({
        mainInert: (document.getElementById("main") as HTMLElement).inert,
        footerInert: (document.querySelector("footer") as HTMLElement).inert,
        overflow: getComputedStyle(document.documentElement).overflow,
        panelInert: (document.getElementById("landing-menu") as HTMLElement).closest("[inert]") !== null,
    }));
    expect(state).toEqual({ mainInert: true, footerInert: true, overflow: "hidden", panelInert: false });
    // The panel sits right under the header and fits the screen.
    const [header, panel] = await Promise.all([
        page.getByRole("banner").boundingBox(),
        page.locator("#landing-menu").boundingBox(),
    ]);
    expect(Math.round(panel!.y)).toBe(Math.round(header!.y + header!.height));
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(PHONE.height);
    // Wheel and touch over the panel's backdrop do not move the page behind.
    await page.mouse.move(195, 800);
    await page.mouse.wheel(0, 600);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("Tab cycles inside the menu: ten tabs come back to the button, the eleventh to «Features»", async ({ page }) => {
    await onAPhone(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.locator("#landing-menu").getByRole("link", { name: "Features" })).toBeFocused();
    const order: string[] = [];
    for (let i = 0; i < 11; i += 1) {
        await page.keyboard.press("Tab");
        order.push(
            await page.evaluate(() => {
                const el = document.activeElement as HTMLElement;
                return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
            }),
        );
    }
    expect(order).toEqual([
        "Why LiTT",
        "Coming soon",
        "Trust",
        "Sign in",
        "Request access",
        "Light", // the theme this test stores
        "English",
        "Privacy notice",
        "Terms and conditions",
        "Menu",
        "Features",
    ]);
    // And Shift+Tab goes back the other way, from the button to the last link.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#landing-menu").getByRole("link", { name: "Terms and conditions" })).toBeFocused();
});

test("Esc closes the menu, gives the focus back to the button and frees the page", async ({ page }) => {
    await onAPhone(page);
    const button = page.getByRole("button", { name: "Menu" });
    await button.click();
    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
    await expect(page.locator("#landing-menu")).toBeHidden();
    const state = await page.evaluate(() => ({
        mainInert: (document.getElementById("main") as HTMLElement).inert,
        overflow: getComputedStyle(document.documentElement).overflow,
    }));
    expect(state.mainInert).toBe(false);
    expect(state.overflow).not.toBe("hidden");
});

test("a section link closes the menu, sets the hash, focuses the heading and leaves it below the header", async ({ page }) => {
    await onAPhone(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#landing-menu").getByRole("link", { name: "Why LiTT" }).click();
    await expect(page.locator("#landing-menu")).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => window.location.hash)).toBe("#por-que");
    await expect(page.locator("#landing-why-title")).toBeFocused();
    // The smooth scroll finishes: the title is below the sticky header, in view.
    await expect
        .poll(async () => {
            const [title, header] = await Promise.all([
                page.locator("#landing-why-title").boundingBox(),
                page.getByRole("banner").boundingBox(),
            ]);
            return title!.y >= header!.y + header!.height - 1 && title!.y < PHONE.height / 2;
        })
        .toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("the backdrop closes the menu", async ({ page }) => {
    await onAPhone(page);
    const button = page.getByRole("button", { name: "Menu" });
    await button.click();
    const panel = await page.locator("#landing-menu").boundingBox();
    // Below the panel there is only the backdrop.
    await page.mouse.click(195, Math.min(PHONE.height - 8, panel!.y + panel!.height + 20));
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toBeFocused();
});

test("theme and language can be changed from the menu, which stays open", async ({ page }) => {
    await onAPhone(page, { locale: "es-MX" });
    await page.getByRole("button", { name: "Menú" }).click();
    const menu = page.locator("#landing-menu");
    await menu.getByRole("radio", { name: "Oscuro" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await menu.getByRole("radio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("link", { name: "Why LiTT" })).toBeVisible();
});

test("opening the menu and widening the window to 1000 px closes it", async ({ page }) => {
    await onAPhone(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.locator("#landing-menu")).toBeHidden();
    const state = await page.evaluate(() => ({
        mainInert: (document.getElementById("main") as HTMLElement).inert,
        overflow: getComputedStyle(document.documentElement).overflow,
        open: document.documentElement.classList.contains("menu-open"),
    }));
    expect(state.mainInert).toBe(false);
    expect(state.open).toBe(false);
    expect(state.overflow).not.toBe("hidden");
});

test("the browser's back button closes an open menu", async ({ page }) => {
    await onAPhone(page);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#landing-menu").getByRole("link", { name: "Trust" }).click();
    await page.getByRole("button", { name: "Menu" }).click();
    await page.goBack();
    await expect(page.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});

for (const theme of ["light", "dark"] as const) {
    test(`with the menu open, axe finds nothing and nothing scrolls sideways (${theme})`, async ({ page }) => {
        await onAPhone(page, { theme });
        await page.getByRole("button", { name: "Menu" }).click();
        await expect(page.locator("#landing-menu").getByRole("link", { name: "Features" })).toBeFocused();
        // The 220 ms entrance is over: contrast is read on settled colors.
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
        const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(widths[0]).toBeLessThanOrEqual(widths[1]);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
}

test("the models the page names are the app's, and GLM-Legal is under OpenRouter", async ({ page }) => {
    await setUp(page, { locale: "en-US", theme: "light" });
    const picker = page.getByRole("img", { name: /^Example model picker/ });
    await expect(picker).toContainText("Claude Sonnet 5.5");
    await expect(picker).toContainText("GLM-Legal");
    await expect(picker).toContainText("Qwen 3");
});
