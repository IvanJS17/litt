import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const fontsCss = readFileSync(join(here, "fonts.css"), "utf8");
const globalsCss = readFileSync(join(here, "..", "globals.css"), "utf8");
const tokensCss = readFileSync(
    join(here, "..", "..", "..", "..", "packages", "ui", "styles", "DesignTokensUI.css"),
    "utf8",
);

describe("self-hosted fonts", () => {
    it("every file fonts.css points at is in this directory", () => {
        const urls = [...fontsCss.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
        expect(urls.length).toBeGreaterThan(10);
        for (const file of urls) expect(existsSync(join(here, file)), file).toBe(true);
    });

    it("every font file is used, and each family keeps its licence", () => {
        const used = new Set([...fontsCss.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]));
        for (const file of readdirSync(here).filter((f) => f.endsWith(".woff2")))
            expect(used.has(file), file).toBe(true);
        for (const licence of ["Inter-OFL.txt", "Newsreader-OFL.txt", "DepartureMono-OFL.txt"])
            expect(existsSync(join(here, licence)), licence).toBe(true);
    });

    it("EB Garamond is gone, files and CSS", () => {
        expect(fontsCss).not.toMatch(/garamond/i);
        expect(readdirSync(here).filter((f) => /garamond/i.test(f))).toEqual([]);
        expect(tokensCss).not.toMatch(/garamond/i);
        expect(globalsCss).not.toMatch(/garamond/i);
    });

    it("Newsreader: roman 400-600, a real italic at 400, latin and latin-ext", () => {
        const faces = fontsCss.match(/@font-face \{[^}]*font-family: "Newsreader";[^}]*\}/g) ?? [];
        expect(faces).toHaveLength(4);
        const roman = faces.filter((f) => f.includes("font-style: normal"));
        const italic = faces.filter((f) => f.includes("font-style: italic"));
        expect(roman).toHaveLength(2);
        expect(italic).toHaveLength(2);
        for (const f of roman) expect(f).toContain("font-weight: 400 600");
        for (const f of italic) expect(f).toMatch(/font-weight: 400;/);
    });

    it("keeps the layout from jumping while Newsreader loads", () => {
        expect(fontsCss).toMatch(
            /font-family: "Newsreader Fallback";\s+src: local\("Times New Roman"\);\s+ascent-override: [\d.]+%;\s+descent-override: [\d.]+%;\s+line-gap-override: 0%;\s+size-adjust: [\d.]+%;/,
        );
        expect(fontsCss).toContain('--font-newsreader: "Newsreader", "Newsreader Fallback"');
    });

    it("Departure Mono is a latin subset with the arrows and the return key", () => {
        const face = fontsCss.match(/@font-face \{[^}]*"Departure Mono"[^}]*\}/)?.[0] ?? "";
        expect(face).toContain("U+2190-2193");
        expect(face).toContain("U+21B5");
        expect(statSync(join(here, "departure-mono-latin.woff2")).size).toBeLessThan(8_000);
    });

    it("serif is Newsreader, pixel is Departure Mono, and nothing is synthesized", () => {
        expect(tokensCss).toContain("--font-serif: var(--font-newsreader);");
        expect(tokensCss).toContain("--font-pixel: var(--font-departure-mono);");
        expect(globalsCss).toMatch(/:root\s*\{\s*font-synthesis: none;\s*\}/);
    });
});
