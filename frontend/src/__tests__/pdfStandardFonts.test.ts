// pdf.js reads the standard fonts of a PDF from the app's own origin. The files
// are copied from the installed library by scripts/copyPdfStandardFonts.mjs
// (run by predev and prebuild) into a git-ignored directory of public/, so they
// always match the installed version and no binary is committed.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STANDARD_FONT_DATA_URL } from "@/app/components/shared/views/highlightQuote";
import {
    PUBLIC_FONT_DIRECTORY,
    copyStandardFonts,
    installedStandardFontsDirectory,
} from "../../scripts/copyPdfStandardFonts.mjs";

const FRONTEND = resolve(__dirname, "../..");
const scratch: string[] = [];
function temporaryDirectory() {
    const dir = mkdtempSync(join(tmpdir(), "litt-fonts-"));
    scratch.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("serving the pdf.js standard fonts from the app", () => {
    it("publishes them at the path the viewer requests", () => {
        expect(STANDARD_FONT_DATA_URL).toBe(`/${PUBLIC_FONT_DIRECTORY}/`);
    });

    it("finds the fonts of the installed pdfjs-dist, including their licences", () => {
        const installed = installedStandardFontsDirectory();
        const names = readdirSync(installed);
        expect(names).toContain("LiberationSans-Regular.ttf");
        expect(names.some((name) => name.startsWith("LICENSE"))).toBe(true);
        expect(installed).toContain(join("node_modules", "pdfjs-dist"));
    });

    it("copies every installed file, byte for byte, and replaces stale files", () => {
        const target = join(temporaryDirectory(), "published");
        mkdirSync(target);
        writeFileSync(join(target, "OldFont.ttf"), "stale");
        const copied = copyStandardFonts(installedStandardFontsDirectory(), target);
        const installed = readdirSync(installedStandardFontsDirectory()).sort();
        expect(readdirSync(target).sort()).toEqual(installed);
        expect(copied.sort()).toEqual(installed);
        for (const name of installed) {
            expect(readFileSync(join(target, name)).equals(readFileSync(join(installedStandardFontsDirectory(), name)))).toBe(true);
        }
    });

    it("refuses an empty or missing source instead of publishing nothing", () => {
        const empty = temporaryDirectory();
        expect(() => copyStandardFonts(empty, join(temporaryDirectory(), "x"))).toThrow(/no standard fonts/i);
        expect(() => copyStandardFonts(join(empty, "missing"), join(temporaryDirectory(), "x"))).toThrow();
    });

    it("keeps the published directory out of git and runs the copy before dev and build", () => {
        const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as { scripts: Record<string, string> };
        expect(manifest.scripts.predev).toContain("scripts/copyPdfStandardFonts.mjs");
        expect(manifest.scripts.prebuild).toContain("scripts/copyPdfStandardFonts.mjs");
        const ignore = readFileSync(join(FRONTEND, "..", ".gitignore"), "utf8").split("\n");
        expect(ignore).toContain(`/frontend/public/${PUBLIC_FONT_DIRECTORY}/`);
    });
});
