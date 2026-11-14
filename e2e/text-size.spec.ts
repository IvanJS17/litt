import fs from "fs";
import path from "path";
import { devices, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Text size (Settings > Appearance). Every /api call is mocked: no backend,
// database or account. The same specs write the review screenshots when
// TEXT_SIZE_SHOTS names a directory.
//
// The phone profile names WebKit; the project runs Chromium, so it is used
// without its browser type.
const { defaultBrowserType: _ignored, ...iPhone14 } = devices["iPhone 14"];
const SHOTS = process.env.TEXT_SIZE_SHOTS;
const SIZE_PX = { normal: 16, large: 18, xlarge: 20 } as const;
type Size = keyof typeof SIZE_PX;

test.use({ storageState: { cookies: [], origins: [] } });

async function signedIn(
    page: Page,
    textSize: Size | undefined,
    patches: Record<string, unknown>[] = [],
) {
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const p = url.pathname;
        if (p === "/api/auth/session") {
            return route.fulfill({ json: { user: { id: "ts", email: "ts@example.test" } } });
        }
        if (p === "/api/user/profile") {
            const body = { onboardingComplete: true, displayName: "Texto Tamaño", apiKeyStatus: {}, creditsRemaining: 100, lastSelectedChatModel: "test-model", darkMode: false, textSize };
            if (request.method() === "PATCH") {
                const sent = request.postDataJSON() as Record<string, unknown>;
                patches.push(sent);
                return route.fulfill({ json: { ...body, ...sent } });
            }
            return route.fulfill({ json: body });
        }
        if (p === "/api/platform/me") return route.fulfill({ json: { admin: false, can_create_org: false } });
        if (p === "/api/models/configured") {
            return route.fulfill({ json: { models: [{ id: "test-model", label: "Test model", source: "Configured" }] } });
        }
        if (p.startsWith("/api/models/")) return route.fulfill({ json: { models: [] } });
        if (p === "/api/projects/filter-options") return route.fulfill({ json: { practices: ["Civil", "Mercantil"], owners: [] } });
        if (p === "/api/projects") {
            return route.fulfill({
                json: [
                    ["Contrato de arrendamiento Torre Norte", "Civil"],
                    ["Constitución de sociedad Grupo Alba", "Mercantil"],
                    ["Revisión de pagarés y garantías", "Mercantil"],
                    ["Juicio ordinario de rescisión", "Civil"],
                ].map(([name, practice], i) => ({
                    id: `p${i}`, user_id: "ts", is_owner: true, access_role: "owner", name, cm_number: `CM-${100 + i}`, practice,
                    created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-10T12:00:00Z", document_count: 3 + i, chat_count: i,
                    owner_display_name: "Texto Tamaño", owner_email: "ts@example.test",
                })),
            });
        }
        return route.fulfill({ json: [] });
    });
    if (textSize) {
        // What the browser remembered from the last visit (the boot script reads it).
        await page.addInitScript((value) => localStorage.setItem("litt:text-size", value), textSize);
    }
}

async function expectNoHorizontalOverflow(page: Page) {
    const { scroll, inner } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
    }));
    expect(scroll, "page is wider than the screen").toBeLessThanOrEqual(inner);
}

async function shot(page: Page, name: string) {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const SCREENS = [
    { slug: "ajustes-apariencia", path: "/settings/appearance", ready: (page: Page) => page.getByRole("radiogroup", { name: "Text size" }) },
    { slug: "chat", path: "/assistant", ready: (page: Page) => page.getByPlaceholder("How can I help?") },
    { slug: "tabla-proyectos", path: "/projects", ready: (page: Page) => page.locator("#main-content").getByText("Contrato de arrendamiento Torre Norte") },
];

for (const device of [
    { name: "escritorio-1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "telefono-390", use: { ...iPhone14, viewport: { width: 390, height: 844 } } },
]) {
    test.describe(`text size on ${device.name}`, () => {
        test.use(device.use);

        for (const size of ["normal", "xlarge"] as const) {
            for (const screen of SCREENS) {
                test(`${screen.slug} at ${size}: scales and does not overflow sideways`, async ({ page }) => {
                    await signedIn(page, size);
                    await page.goto(screen.path);
                    await expect(screen.ready(page)).toBeVisible();
                    await page.waitForTimeout(500);
                    const rootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
                    expect(rootPx).toBe(SIZE_PX[size]);
                    if (size === "normal") await expect(page.locator("html")).not.toHaveAttribute("data-text-size", /.+/);
                    else await expect(page.locator("html")).toHaveAttribute("data-text-size", size);
                    await expectNoHorizontalOverflow(page);
                    await shot(page, `${screen.slug}-${device.name}-${size === "normal" ? "100" : "125"}`);
                });
            }
        }
    });
}

test.describe("text size behaviour", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("choosing a size saves it and applies it at once", async ({ page }) => {
        const patches: Record<string, unknown>[] = [];
        await signedIn(page, undefined, patches);
        await page.goto("/settings/appearance");
        await expect(page.getByText("Choose how large text looks in LiTT. This only changes your screen.")).toBeVisible();
        await page.getByRole("radio", { name: "Large", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
        expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("18px");
        expect(patches).toContainEqual({ textSize: "large" });
        await expect(page.getByRole("radio", { name: "Large", exact: true })).toHaveAttribute("aria-checked", "true");
    });

    test("the remembered size is on <html> before the profile answers", async ({ page }) => {
        await signedIn(page, "large");
        // Registered last, so it wins: the profile never answers.
        await page.route("**/api/user/profile", () => {});
        await page.goto("/settings/appearance", { waitUntil: "commit" });
        await expect(page.locator("html")).toHaveAttribute("data-text-size", "large");
    });
});

test.describe("on a phone", () => {
    test.use({ ...iPhone14 });

    test("fields stay at 16 px or more at every size, so iOS does not zoom", async ({ page }) => {
        for (const size of ["normal", "xlarge"] as const) {
            await signedIn(page, size);
            await page.goto("/assistant");
            const field = page.getByPlaceholder("How can I help?");
            await expect(field).toBeVisible();
            const px = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
            expect(px).toBeGreaterThanOrEqual(16);
            await page.unroute("**/api/**");
        }
    });
});
