import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// "Superficies de LiTT" (docs/design-system.md): nothing in the interface is
// white. The pure white is `bg-surface-document`, for the user's own documents
// (a PDF or DOCX page, a page thumbnail, the Word preview, a QR code that a
// scanner must read). What came from MikeOSS (a white menu, a translucent white
// glass, white rims and glows) is the hoja, the campo or a tinta tint.
//
// This reads the sources: a `bg-white` in a component is a regression unless it
// is in the list below, which names each use and why it stays.

const repoRoot = resolve(process.cwd(), "..");
const ROOTS = ["frontend/src", "packages/ui/src", "word-addin/src"];
const SOURCE = /\.(tsx?|css)$/;
const SKIP = /\.(test|stories)\.|\/fonts\//;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (SOURCE.test(path) && !SKIP.test(path)) out.push(path);
    }
    return out;
}

const files = ROOTS.flatMap((root) => walk(join(repoRoot, root))).map((path) => ({
    path: relative(repoRoot, path),
    text: readFileSync(path, "utf8"),
}));

/** Where white is still the right color, and why. */
const ALLOWED: Record<string, string> = {
    // The knob of a switch is a physical white part; the dark palette gives it papel.
    "packages/ui/src/ToggleSwitchUI.tsx": "switch thumb",
    // The spinner's white arc sits on the filled (tinta) button.
    "frontend/src/app/support/page.tsx": "spinner on a filled button",
};

const WHITE_SURFACE = /\bbg-white(\/\d+)?\b|\b(?:border|ring|divide|outline)-white(\/\d+)?\b|rgba\(\s*255,\s*255,\s*255|rgb\(\s*255\s+255\s+255|(?:inset|_)(?:[-\d._]*)rgba\(255/;

describe("white in the interface", () => {
    it("reads the sources", () => {
        expect(files.length).toBeGreaterThan(500);
    });

    it("only the listed uses are white", () => {
        const offenders = files
            .filter(({ path, text }) => WHITE_SURFACE.test(text) && !(path in ALLOWED))
            .map(({ path }) => path);
        expect(offenders).toEqual([]);
    });

    it("every listed use still exists, so the list cannot go stale", () => {
        for (const path of Object.keys(ALLOWED)) {
            const file = files.find((f) => f.path === path);
            expect(file, path).toBeDefined();
            expect(WHITE_SURFACE.test(file!.text), `${path} no longer uses white`).toBe(true);
        }
    });

    it("the user's documents, and only they, use the document white", () => {
        const users = files
            .filter(({ text }) => /\bbg-surface-document\b/.test(text))
            .map(({ path }) => path);
        expect([...users].sort()).toEqual([
            // A QR code needs a white quiet zone to be read.
            "frontend/src/app/(pages)/settings/security/page.tsx",
            // A page of a PDF, drawn with its own shadow (the DOCX page is
            // EigenPal's and keeps its own white).
            "frontend/src/app/components/shared/views/PdfView.tsx",
        ]);
    });

    it("no component fills with the old near-whites", () => {
        const offenders = files
            .filter(({ path, text }) => !/DesignTokensUI\.css$/.test(path) && /#fcfcfb|#f9f9f7/i.test(text))
            .map(({ path }) => path);
        expect(offenders).toEqual([]);
    });
});
