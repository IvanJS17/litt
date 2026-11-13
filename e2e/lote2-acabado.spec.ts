import { test, expect } from "@playwright/test";

// Lote 2 · acabado, in a real browser with every /api call mocked (no
// backend, no account): the legal pages as static server HTML with their
// anchors, the empty Projects page, and the Settings loading frame.

test.use({ storageState: { cookies: [], origins: [] } });

for (const path of ["/terminos", "/privacidad"]) {
    test(`${path} has the logo, a way back, a contents list and readable letters on a phone`, async ({ page }) => {
        await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not signed in" } }));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(path);

        await expect(page.getByRole("img", { name: "LiTT", exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Back" })).toBeVisible();

        // The text is in the HTML the server sent: no hydration needed to read it.
        const html = await (await page.request.get(path)).text();
        expect(html).toContain('id="1"');

        const article = page.getByTestId("legal-text");
        const fontSize = await article.locator("p").first().evaluate((el) => getComputedStyle(el).fontSize);
        expect(fontSize).toBe("16px");

        // Opening the contents and following an entry lands on that section.
        await page.getByText("Contents", { exact: true }).click();
        const links = page.locator("details").first().getByRole("link");
        expect(await links.count()).toBeGreaterThan(5);
        await links.nth(3).click();
        await expect(page).toHaveURL(new RegExp(`${path}#4$`));
        await expect(page.locator("h2[id='4']")).toBeInViewport();
    });
}

test("the managed-account clause is reachable as /terminos#5-5, in the same tab", async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not signed in" } }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/terminos#5-5");
    const clause = page.locator("li[id='5-5']");
    await expect(clause).toContainText("Cuentas administradas por el despacho");
    await expect(clause).toBeInViewport();
});

async function signedIn(page: import("@playwright/test").Page, sessionGate?: Promise<void>) {
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/session") {
            if (sessionGate) await sessionGate;
            return route.fulfill({ json: { user: { id: "lote2", email: "lote2@example.test" } } });
        }
        if (path === "/api/user/profile") {
            return route.fulfill({ json: { onboardingComplete: true, displayName: "Lote 2", apiKeyStatus: {}, creditsRemaining: 100 } });
        }
        if (path === "/api/projects/filter-options") return route.fulfill({ json: { practices: [], owners: [] } });
        if (path === "/api/orgs") return route.fulfill({ json: [] });
        return route.fulfill({ json: [] });
    });
}

test("Projects with nothing says so once, with one way to start and no table chrome", async ({ page }) => {
    await signedIn(page);
    await page.goto("/projects");
    await expect(page.getByText("You have no projects yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "New project" })).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: "Select all projects" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Filter by practice" })).toHaveCount(0);
});

test("Settings draws its frame in grey lines while the session loads", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await signedIn(page, gate);
    await page.goto("/settings");
    const skeleton = page.locator("[data-slot='settings-shell-skeleton']");
    await expect(skeleton).toBeVisible();
    // With the sidebar around it, not a spinner on a bare screen.
    await expect(page.locator("[data-slot='app-shell-skeleton-sidebar']")).toBeVisible();
    await expect(page.locator(".animate-spin")).toHaveCount(0);
    release();
    await expect(skeleton).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Settings" })).toBeVisible();
});
