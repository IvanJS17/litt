// The DOCX editor must not make network requests of its own: documents are
// confidential, so even a font lookup would tell a third party what is being
// opened (ledger §16.3 "DOCX viewer and editor"). Fonts come from
// @docx-editor.dev/fonts (packaged files bundled with the app). This guards
// the two ways that could change: importing the opt-in `fonts/google`
// subpath, and an editor release that starts to fetch from a CDN.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");
const repo = resolve(root, "..");

function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) sources(path, out);
        else if (/\.(tsx?|mjs|js)$/.test(name) && !path.endsWith("docxEditorNetwork.test.ts")) out.push(path);
    }
    return out;
}

describe("DOCX editor makes no network requests of its own", () => {
    it("never imports the Google-hosted font source", () => {
        const offenders = [
            ...sources(join(root, "src")),
            ...sources(join(repo, "packages")),
            ...sources(join(root, "docx-roundtrip")),
        ].filter((file) => readFileSync(file, "utf8").includes("@docx-editor.dev/fonts/google"));
        expect(offenders).toEqual([]);
    });

    it.each(["core", "react", "fonts"])(
        "@docx-editor.dev/%s fetches from no CDN or font service unless its opt-in google entry is used",
        (name) => {
            const dist = join(root, "node_modules", "@docx-editor.dev", name, "dist");
            const files = readdirSync(dist).filter(
                (file) => /\.(js|cjs|css)$/.test(file) && !/^google\.c?js$/.test(file),
            );
            expect(files.length).toBeGreaterThan(0);
            const offenders = files.filter((file) =>
                /cdn\.jsdelivr|fonts\.googleapis|fonts\.gstatic|unpkg\.com|cdnjs/.test(readFileSync(join(dist, file), "utf8")),
            );
            expect(offenders).toEqual([]);
        },
    );
});
