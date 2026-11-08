import { test, expect } from "@playwright/test";

// The sign-in card, its links and the language selector must fit a short
// laptop window (1280×640) without a page scroll (AuthPageShell). The
// selector sits under the card on every signed-out screen, so it is what
// tips /login over the edge if its height grows. Every /api call is mocked:
// this spec needs no backend.
//
// The card is measured only once SETTLED. While GET /api/auth/providers is in
// flight it is a 200 px loading skeleton; when it resolves it grows to 336 px
// (divider + Google + SSO buttons), and measuring earlier cannot fail because
// the shell is min-h-dvh. The worst case (both providers on) is tested next to
// production (both off). With the selector back at h-8 the worst case
// overflows to scrollHeight 642 > 640; with h-6 it fits.

test.use({ storageState: { cookies: [], origins: [] } });

const PROVIDERS = [
    { name: "both providers on (worst case)", providers: { sso: true, google: true }, authButtons: 2 },
    { name: "providers off (production)", providers: { sso: false, google: false }, authButtons: 0 },
];

for (const locale of ["es-MX", "en-US"] as const) {
    for (const { name, providers, authButtons } of PROVIDERS) {
        test(`/login fits 1280×640 without scrolling in ${locale}, ${name}`, async ({ page, context, baseURL }) => {
            await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { detail: "Not signed in" } }));
            await page.route("**/api/auth/providers", (route) => route.fulfill({ status: 200, json: providers }));
            await context.addCookies([{ name: "LITT_LOCALE", value: locale, url: baseURL! }]);
            await page.setViewportSize({ width: 1280, height: 640 });
            const providersResponse = page.waitForResponse("**/api/auth/providers");
            await page.goto("/login");
            await providersResponse;

            const selector = page.getByRole("combobox");
            await expect(selector).toBeVisible();
            // Settled marker: the form (submit button + the provider buttons)
            // is fully rendered, not the loading skeleton.
            const form = page.locator("form").first();
            await expect(form).toBeVisible();
            await expect(page.locator("main button, form ~ button, button").filter({ hasNot: page.locator("svg[aria-hidden]:only-child") }).first()).toBeVisible();
            if (authButtons > 0) {
                await expect(page.locator("button:has(svg)").filter({ hasText: /Google|SSO/ })).toHaveCount(authButtons);
            }

            const { scrollHeight, innerHeight } = await page.evaluate(() => ({
                scrollHeight: document.documentElement.scrollHeight,
                innerHeight: window.innerHeight,
            }));
            console.log(`MEASURE ${locale} ${name}: scrollHeight=${scrollHeight} innerHeight=${innerHeight}`);
            expect(scrollHeight).toBeLessThanOrEqual(innerHeight);

            // The selector is on screen, not pushed below the fold or under the card.
            const box = (await selector.boundingBox())!;
            expect(box.y + box.height).toBeLessThanOrEqual(innerHeight);
            const card = (await form.boundingBox())!;
            expect(box.y).toBeGreaterThanOrEqual(card.y + card.height);
        });
    }
}
