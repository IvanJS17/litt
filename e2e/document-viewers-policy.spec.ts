/**
 * Document viewers under the enforced page policy.
 *
 * CI serves a production build (`next start`) and does not set
 * LITT_CSP_REPORT_ONLY, so every page here carries the same enforced
 * Content-Security-Policy a deployment does (frontend/src/proxy.ts,
 * frontend/src/app/lib/securityHeaders.ts). `next dev` adds 'unsafe-eval' and
 * unit tests run no browser, so neither notices a viewer that needs something
 * the policy refuses — the Word viewer compiles a WebAssembly module, for one.
 * Each test opens a document of one format from the project's document list and
 * checks three things: its content is shown, the viewer's own failure message
 * is not, and the browser reported no `securitypolicyviolation` event.
 *
 * Auth: every test runs signed in as this worker's account (the storageState
 * fixture in e2e/fixtures.ts). Each test creates its own uniquely named
 * project, so the tests are isolated. The documents are synthetic.
 */
import fs from "fs";
import path from "path";
import { test, expect, type Page } from "./fixtures";
import { createProject, PDF_FIXTURE } from "./helpers";
import { recordCspViolations } from "./cspViolations";
import { writeSyntheticDocx } from "./syntheticDocx";

/** The English catalog the suite runs in (playwright.config.ts pins en-US). */
const MESSAGES = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../packages/i18n/messages/en-US.json"), "utf8"),
) as Record<string, unknown>;

/** A message by its dotted key, so a reworded failure message cannot hide a failure. */
function message(key: string): string {
    const value = key.split(".").reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        MESSAGES,
    );
    if (typeof value !== "string") throw new Error(`No English message for ${key}`);
    return value;
}

/**
 * Open the document named `filename` from the project's document list.
 *
 * Rows are `[data-document-row]`. While a row's upload is still being
 * processed its checkbox is replaced by a spinner, so wait for the checkbox
 * before clicking; a click on the row opens the document in the side panel
 * (DocTable.handleDocumentRowClick).
 */
async function openDocument(page: Page, filename: string) {
    const row = page.locator("[data-document-row]").filter({ hasText: filename });
    await expect(row.locator('input[type="checkbox"]')).toBeVisible({ timeout: 30_000 });
    await row.getByText(filename, { exact: true }).first().click();
}

test("a Word document opens under the enforced page policy", async ({ page }, testInfo) => {
    const csp = await recordCspViolations(page);

    const filename = "synthetic-agreement.docx";
    const sentence = "Payment is due within thirty days.";
    const file = writeSyntheticDocx(testInfo.outputPath(filename), [
        "Synthetic services agreement",
        sentence,
    ]);
    await createProject(page, `E2E Word view ${Date.now()}`, file);
    await openDocument(page, filename);

    const viewer = page.locator('[data-docx-renderer="eigenpal"]');
    const failure = page
        .getByRole("alert")
        .filter({ hasText: message("shared.docxView.thisDocumentCouldNotBeDisplayed") });

    // REGRESSION: fails when the viewer cannot lay the document out (its
    // WebAssembly module refused by script-src leaves the failure message).
    await expect(viewer.getByText(sentence)).toBeVisible({ timeout: 30_000 });
    await expect(failure).toHaveCount(0);

    /* The failure replaces the text a moment AFTER it first appears: the
       viewer paints, then its layout engine fails to start. Give that time to
       happen, then require the final state. */
    await page.waitForTimeout(3_000);
    await expect(viewer.getByText(sentence)).toBeVisible();
    await expect(failure).toHaveCount(0);

    // REGRESSION: fails on any directive the production policy refuses.
    csp.expectNone("the Word viewer");
});

test("a PDF opens under the enforced page policy", async ({ page }) => {
    const csp = await recordCspViolations(page);

    await createProject(page, `E2E PDF view ${Date.now()}`, PDF_FIXTURE);
    await openDocument(page, path.basename(PDF_FIXTURE));

    // The PDF viewer paints its text layer once the page is rendered.
    await expect(page.locator(".pdf-text-layer").first()).toContainText("Test PDF Document", {
        timeout: 30_000,
    });
    await expect(page.getByText(message("shared.pdfView.failedToLoadDocument"))).toHaveCount(0);

    // The viewer's standard fonts are served by the app itself; a missing font
    // is not a policy violation, the PDF is just drawn with a substitute.
    const font = await page.request.get("/standard_fonts/LiberationSans-Regular.ttf");
    expect(font.status(), "the app serves the PDF viewer's standard fonts").toBe(200);

    // REGRESSION: fails on any directive the production policy refuses.
    csp.expectNone("the PDF viewer");
});
