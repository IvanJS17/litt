import { test, expect } from "@playwright/test";

// The sign-in card, its links and the language selector must fit a short
// laptop window (1280×640) without a page scroll (AuthPageShell). The
// selector sits under the card on every signed-out screen, so it is what
// tips /login over the edge if its height grows. Every /api call is mocked:
// this spec needs no backend.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not signed in" } }));
});

for (const locale of ["es-MX", "en-US"] as const) {
    for (const height of [640, 634]) {
        // 634 keeps a 6 px margin: a small copy change must not bring the scroll back.
        test(`/login fits 1280×${height} without scrolling in ${locale}`, async ({ page, context, baseURL }) => {
            await context.addCookies([{ name: "LITT_LOCALE", value: locale, url: baseURL! }]);
            await page.setViewportSize({ width: 1280, height: height });
            await page.goto("/login");
            const selector = page.getByRole("combobox");
            await expect(selector).toBeVisible();

            const { scrollHeight, innerHeight } = await page.evaluate(() => ({
                scrollHeight: document.documentElement.scrollHeight,
                innerHeight: window.innerHeight,
            }));
            expect(scrollHeight).toBeLessThanOrEqual(innerHeight);

            // The selector is on screen, not pushed below the fold or under the card.
            const box = (await selector.boundingBox())!;
            expect(box.y + box.height).toBeLessThanOrEqual(innerHeight);
            const card = (await page.locator("form").first().boundingBox())!;
            expect(box.y).toBeGreaterThanOrEqual(card.y + card.height);
        });
    }
}
