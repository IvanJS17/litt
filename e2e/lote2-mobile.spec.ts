import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Lote 2 · móvil. Phone behaviour of the shell, checked in a real browser at
// the iPhone 14 size with touch, and the desktop behaviour that must not
// change. Every /api call is mocked: no backend, database or account.
//
// Playwright's iPhone 14 profile names WebKit; the project runs Chromium, so
// the profile is used without its browser type (viewport, touch, UA, scale).
const { defaultBrowserType: _ignored, ...iPhone14 } = devices["iPhone 14"];

test.use({ storageState: { cookies: [], origins: [] } });

async function signedIn(page: Page, chatPosts: string[] = [], profile: Record<string, unknown> = {}) {
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === "/api/auth/session") {
            return route.fulfill({ json: { user: { id: "lote2", email: "lote2@example.test" } } });
        }
        if (path === "/api/user/profile") {
            return route.fulfill({
                json: { onboardingComplete: true, displayName: "Lote Dos", apiKeyStatus: {}, creditsRemaining: 100, lastSelectedChatModel: "test-model", ...profile },
            });
        }
        if (path === "/api/models/configured") {
            return route.fulfill({ json: { models: [{ id: "test-model", label: "Test model", source: "Configured" }] } });
        }
        if (path.startsWith("/api/models/")) return route.fulfill({ json: { models: [] } });
        if (path === "/api/projects/filter-options") return route.fulfill({ json: { practices: [], owners: [] } });
        if (path === "/api/chat" && request.method() === "POST") {
            chatPosts.push(request.postData() ?? "");
            return route.fulfill({
                status: 200,
                headers: { "Content-Type": "text/event-stream" },
                body: 'data: {"type":"chat_id","chatId":"c1","assistantMessageId":"a1"}\n\ndata: {"type":"content_delta","text":"Hola"}\n\ndata: [DONE]\n\n',
            });
        }
        return route.fulfill({ json: [] });
    });
}

test.describe("on a phone (iPhone 14, touch)", () => {
    test.use({ ...iPhone14 });

    test("a dialog is a sheet that rises from the bottom edge", async ({ page }, testInfo) => {
        await signedIn(page);
        await page.goto("/projects");
        await page.getByRole("button", { name: "New project" }).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(400); // the 250 ms rise
        const box = (await dialog.boundingBox())!;
        const viewport = page.viewportSize()!;
        expect(box.x).toBe(0);
        expect(box.width).toBe(viewport.width);
        // Flush with the bottom edge, never taller than the visible height.
        expect(Math.round(box.y + box.height)).toBe(viewport.height);
        expect(box.height).toBeLessThanOrEqual(viewport.height);
        const style = await dialog.evaluate((el) => {
            const css = getComputedStyle(el);
            return {
                top: css.borderTopLeftRadius,
                bottom: css.borderBottomLeftRadius,
                maxHeight: css.maxHeight,
            };
        });
        expect(parseFloat(style.top)).toBeGreaterThan(16);
        expect(parseFloat(style.bottom)).toBe(0);
        await expect(dialog.locator('[data-slot="modal-grabber"]')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("sheet-phone.png") });

        // Closing plays the 180 ms exit, then the sheet is gone.
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0, { timeout: 2_000 });
    });

    test("Settings opens on a grouped list, with the search above it; a row opens a section with a back button", async ({ page }, testInfo) => {
        await signedIn(page);
        await page.goto("/settings/menu");
        const search = page.getByRole("searchbox", { name: "Search settings" });
        await expect(search).toBeVisible();
        const list = page.locator('[data-slot="settings-phone-list"]');
        await expect(list).toBeVisible();
        const searchBox = (await search.boundingBox())!;
        const listBox = (await list.boundingBox())!;
        expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(listBox.y);
        // The groups, and no strip of tabs.
        for (const group of ["My account", "How I work", "My keys and services", "My training", "My firms"]) {
            await expect(list.getByRole("heading", { name: group, exact: true })).toBeVisible();
        }
        await expect(page.locator("nav ul.flex").first()).toBeHidden();
        // Rows are 44 px tall.
        const row = (await list.getByRole("link", { name: "Memory" }).boundingBox())!;
        expect(row.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: testInfo.outputPath("settings-list-phone.png"), fullPage: true });

        await list.getByRole("link", { name: "Memory" }).click();
        await expect(page).toHaveURL(/\/settings\/memory$/);
        const back = page.getByRole("link", { name: "Settings" }).first();
        await expect(back).toBeVisible();
        await expect(search).toBeHidden();
        await page.screenshot({ path: testInfo.outputPath("settings-section-phone.png") });
        await back.click();
        await expect(page).toHaveURL(/\/settings\/menu$/);
    });

    test("a direct link to /settings still opens the Account page", async ({ page }) => {
        await signedIn(page);
        await page.goto("/settings");
        await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Settings" }).first()).toHaveAttribute("href", "/settings/menu");
    });

    test("the sidebar slides in as a window, and Escape closes it", async ({ page }, testInfo) => {
        await signedIn(page);
        await page.goto("/assistant");
        const trigger = page.getByRole("button", { name: "Open sidebar" }).first();
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        const sidebar = page.locator("#app-sidebar");
        await expect(sidebar).toHaveAttribute("inert", "");
        await expect(sidebar).toBeHidden();

        await trigger.click();
        const dialog = page.getByRole("dialog", { name: "Main navigation" });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute("aria-modal", "true");
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        // The rest of the page is inert while it is open.
        await expect(page.locator("main").locator("xpath=..")).toHaveAttribute("inert", "");
        // It moves with transform, not the width, in 250 ms.
        const motion = await sidebar.evaluate((el) => {
            const css = getComputedStyle(el);
            return { property: css.transitionProperty, duration: css.transitionDuration, width: css.width };
        });
        expect(motion.property).toContain("transform");
        expect(motion.property).not.toContain("width");
        expect(motion.duration).toContain("0.25s");
        await page.waitForTimeout(400);
        expect((await sidebar.boundingBox())!.width).toBeCloseTo(248, 0);
        // The veil is ink at 25 %.
        const veil = await page.locator("div.fixed.inset-0[aria-hidden='true']").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(veil).toMatch(/^color\(srgb 0\.0823\d* 0\.101\d* 0\.149\d* \/ 0\.25\)$|^rgba\(21, 26, 38, 0\.25\)$/);
        await page.screenshot({ path: testInfo.outputPath("sidebar-open-phone.png") });

        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await expect(trigger).toBeFocused();
        await expect(sidebar).toHaveAttribute("inert", "");
    });

    test("Enter breaks the line, the arrow sends, and the keyboard closes", async ({ page }) => {
        const posts: string[] = [];
        await signedIn(page, posts);
        await page.goto("/assistant");
        const box = page.getByPlaceholder("How can I help?");
        await expect(box).toBeVisible();
        await box.click();
        await box.pressSequentially("Primera línea");
        await box.press("Enter");
        await box.pressSequentially("Segunda línea");
        await expect(box).toHaveValue("Primera línea\nSegunda línea");
        expect(posts).toHaveLength(0);
        await expect(box).toHaveAttribute("enterkeyhint", "enter");

        await expect(box).toBeFocused();
        await page.getByRole("button", { name: "Send message" }).tap();
        await expect.poll(() => posts.length).toBe(1);
        expect(posts[0]).toContain("Segunda línea");
        // The on-screen keyboard is closed: the box no longer holds focus.
        await expect(box).not.toBeFocused();
    });
});

test.describe("on a desktop (nothing changes)", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("a dialog stays centred", async ({ page }, testInfo) => {
        await signedIn(page);
        await page.goto("/projects");
        await page.getByRole("button", { name: "New project" }).first().click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(300);
        const box = (await dialog.boundingBox())!;
        const viewport = page.viewportSize()!;
        expect(box.width).toBeLessThan(viewport.width);
        expect(Math.round(box.x + box.width / 2)).toBe(viewport.width / 2);
        expect(box.y + box.height).toBeLessThan(viewport.height - 8);
        await expect(dialog.locator('[data-slot="modal-grabber"]')).toHaveCount(1);
        await expect(dialog.locator('[data-slot="modal-grabber"]')).toBeHidden();
        expect(parseFloat(await dialog.evaluate((el) => getComputedStyle(el).borderBottomLeftRadius))).toBeGreaterThan(16);
        await page.screenshot({ path: testInfo.outputPath("dialog-desktop.png") });
    });

    test("Settings keeps its tab strip; /settings/menu leads to the Account page", async ({ page }) => {
        await signedIn(page);
        await page.goto("/settings");
        await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name: "Memory" })).toBeVisible();
        await expect(page.locator('[data-slot="settings-phone-list"]')).toHaveCount(0);
        await page.goto("/settings/menu");
        await expect(page).toHaveURL(/\/settings$/);
    });

    test("Enter sends, Shift+Enter breaks the line, and the box keeps focus", async ({ page }) => {
        const posts: string[] = [];
        await signedIn(page, posts);
        await page.goto("/assistant");
        const box = page.getByPlaceholder("How can I help?");
        await box.fill("Uno");
        await box.press("Shift+Enter");
        await box.pressSequentially("Dos");
        await expect(box).toHaveValue("Uno\nDos");
        expect(posts).toHaveLength(0);
        await box.press("Enter");
        await expect.poll(() => posts.length).toBe(1);
    });

    test("the sidebar toggles in 200 ms by width and radius only, and is a named navigation", async ({ page }) => {
        await signedIn(page);
        await page.goto("/assistant");
        const sidebar = page.locator("#app-sidebar");
        await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
        const css = await sidebar.evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                property: style.transitionProperty,
                duration: style.transitionDuration,
                easing: style.transitionTimingFunction,
            };
        });
        expect(css.property).toBe("width, border-radius");
        expect(css.duration).toBe("0.2s");
        expect(css.easing).toContain("cubic-bezier(0.32, 0.72, 0, 1)");
        await expect(sidebar).not.toHaveAttribute("inert");
        await expect(sidebar).not.toHaveAttribute("role");
        // The page beside it is laid out once: its width changes at the first
        // frame, not over the 200 ms.
        const main = page.locator("main");
        const open = (await main.boundingBox())!.width;
        await page.getByRole("button", { name: "Close sidebar" }).click();
        const early = (await main.boundingBox())!.width;
        await page.waitForTimeout(400);
        const closed = (await main.boundingBox())!.width;
        expect(closed).toBeGreaterThan(open);
        expect(early).toBeCloseTo(closed, 0);
    });

    test("Skip to content is the first stop and lands on the page", async ({ page }) => {
        await signedIn(page);
        await page.goto("/assistant");
        await expect(page.locator("main")).toBeVisible();
        await page.keyboard.press("Tab");
        const skip = page.getByRole("link", { name: "Skip to content" });
        await expect(skip).toBeFocused();
        await expect(skip).toBeInViewport();
        await page.keyboard.press("Enter");
        await expect(page.locator("main#main-content")).toBeFocused();
    });
});

test.describe("web app manifest and closed beta", () => {
    test("the manifest is served, and says full-screen LiTT", async ({ page, request }) => {
        await signedIn(page);
        await page.goto("/login");
        const href = await page.locator('link[rel="manifest"]').getAttribute("href");
        expect(href).toBe("/manifest.webmanifest");
        const response = await request.get("/manifest.webmanifest");
        expect(response.status()).toBe(200);
        expect(response.headers()["content-type"]).toContain("json");
        const manifest = await response.json();
        expect(manifest).toMatchObject({ name: "LiTT", display: "standalone", start_url: "/assistant" });
        for (const icon of manifest.icons) {
            expect((await request.get(icon.src)).status(), icon.src).toBe(200);
        }
        await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
        await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "LiTT");
    });

    test("theme-color is papel on light and tinta on dark, following the person's theme", async ({ page }) => {
        // The theme is the profile's: papel on the light one, tinta on the dark one.
        await signedIn(page, [], { darkMode: false });
        await page.goto("/assistant");
        await expect(page.locator("main")).toBeVisible();
        await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ECECE6");

        await page.unroute("**/api/**");
        await signedIn(page, [], { darkMode: true });
        await page.reload();
        await expect(page.locator("html")).toHaveClass(/dark/);
        await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#151A26");
    });

    test("robots.txt is text and turns crawlers away; every page says noindex", async ({ page, request }) => {
        const robots = await request.get("/robots.txt");
        expect(robots.status()).toBe(200);
        expect(robots.headers()["content-type"]).toContain("text/plain");
        const text = await robots.text();
        expect(text).toMatch(/User-Agent: \*/i);
        expect(text).toMatch(/Disallow: \//);
        expect(text).not.toContain("<html");
        const login = await request.get("/login");
        expect(login.headers()["x-robots-tag"]).toBe("noindex, nofollow");
        const manifest = await request.get("/manifest.webmanifest");
        expect(manifest.headers()["x-robots-tag"]).toBe("noindex, nofollow");
        await page.goto("/login");
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    });
});
