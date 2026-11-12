// Round trip through the real editor in a real browser: load a synthetic
// .docx, save it untouched, then make one small edit and save again, and
// compare what a lawyer would notice losing (text, tables, numbering,
// comments, tracked changes, header/footer, bold/italic). It also records
// every request the page makes: the editor must stay on its own origin.
import { expect, test } from "@playwright/test";
import { FIXTURES } from "./fixtures";
import { summarize, type DocxSummary } from "./summary";

test.describe.configure({ mode: "serial" });

const requests: string[] = [];
test.beforeEach(async ({ page }) => {
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await page.waitForFunction(() => !!(window as unknown as { harness?: unknown }).harness);
});

test.afterAll(() => {
    const foreign = requests.filter((url) => !/^(http:\/\/localhost|http:\/\/127\.0\.0\.1|data:|blob:)/.test(url));
    expect(foreign, `requests outside the local origin: ${foreign.join(", ")}`).toEqual([]);
    // The fonts the documents use were served by the app itself (packaged files), not looked up elsewhere.
    expect(requests.some((url) => /\.(ttf|woff2?)(\?|$)/.test(url)), "no packaged font file was requested").toBe(true);
});

for (const fixture of FIXTURES) {
    test(`no pierde nada: ${fixture.name}`, async ({ page }) => {
        const original = new Uint8Array(await fixture.build());
        const before = await summarize(original);

        const opened = await page.evaluate((bytes) => window.harness.load(bytes), Array.from(original));
        expect(opened.parseError).toBeNull();

        // 1. Save without changes.
        const untouched = new Uint8Array(await page.evaluate(() => window.harness.save()));
        // The editor really re-serialized the file (not a byte copy), so the comparison means something.
        expect(Buffer.from(untouched).equals(Buffer.from(original))).toBe(false);
        if (process.env.ROUNDTRIP_DEBUG) console.log(fixture.name, JSON.stringify(before));
        expect(await summarize(untouched)).toEqual(before);

        // 2. One small edit, then save: only that word may differ.
        const replaced = await page.evaluate(([f, w]) => window.harness.replaceText(f, w), [fixture.editFind, fixture.editWith]);
        expect(replaced).toBe(true);
        const edited = await summarize(new Uint8Array(await page.evaluate(() => window.harness.save())));
        const expected: DocxSummary = {
            ...before,
            bodyText: before.bodyText.map((t) => t.replace(fixture.editFind, fixture.editWith)),
        };
        expect(edited).toEqual(expected);
    });
}
