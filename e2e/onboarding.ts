import { expect, type Page } from "@playwright/test";

/**
 * Finish onboarding for a newly bootstrapped E2E user. Legacy-exempt users can
 * briefly visit the profile URL while their profile loads, so wait for either
 * the rendered onboarding form or the final assistant screen.
 */
export async function completeOnboardingIfRequired(page: Page): Promise<void> {
    await page.waitForURL(/\/(assistant|onboarding\/profile)/, {
        timeout: 15_000,
    });
    if (new URL(page.url()).pathname === "/onboarding/profile") {
        const continueButton = page.getByRole("button", { name: "Continue", exact: true });
        const assistantInput = page.getByRole("combobox", {
            name: "How can I help?",
        });
        /* A new account has not accepted the current Terms yet, so the gate
           shows the acceptance screen first (TermsAcceptance). Accept it, then
           continue with the normal onboarding steps. */
        const termsCheckbox = page.getByRole("checkbox", {
            name: /read and accept|Leí y acepto/i,
        });
        await expect(
            termsCheckbox.or(continueButton).or(assistantInput),
        ).toBeVisible({ timeout: 15_000 });
        if (await termsCheckbox.isVisible()) {
            await termsCheckbox.check();
            await page
                .getByRole("button", { name: /Accept and continue|Aceptar y continuar/i })
                .click();
        }
        await expect(continueButton.or(assistantInput)).toBeVisible({
            timeout: 15_000,
        });
        if (await continueButton.isVisible()) {
            await continueButton.click();
            await page.waitForURL(/\/onboarding\/practice/, {
                timeout: 15_000,
            });
            await page.getByRole("button", { name: "Skip" }).click();
            await page.waitForURL(/\/onboarding\/invitations/, {
                timeout: 15_000,
            });
            await page.getByRole("button", { name: "Continue", exact: true }).click();
            await page.waitForURL(/\/onboarding\/models/, {
                timeout: 15_000,
            });
            await page.getByRole("button", { name: "Finish" }).click();
        }
    }
    await page.waitForURL(/\/assistant/, { timeout: 15_000 });
}
