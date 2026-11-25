// pdf.js reads its fonts, image decoders, character maps and colour profile
// from the app's own origin. The files are copied from the installed library by
// scripts/copyPdfViewerAssets.mjs (run by predev and prebuild) into the
// git-ignored public/pdfjs/, so they always match the installed version and no
// binary is committed.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PDF_VIEWER_ASSET_URLS } from "@/app/components/shared/views/highlightQuote";
import {
    PDF_VIEWER_ASSET_DIRECTORIES,
    PUBLIC_PDFJS_DIRECTORY,
    copyAssetDirectory,
    installedPdfjsDirectory,
    publishPdfViewerAssets,
    publishedPdfViewerAssetsDirectory,
} from "../../scripts/copyPdfViewerAssets.mjs";

const FRONTEND = resolve(__dirname, "../..");
const scratch: string[] = [];
function temporaryDirectory() {
    const dir = mkdtempSync(join(tmpdir(), "litt-pdfjs-"));
    scratch.push(dir);
    return dir;
}
afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sameBytes(a: string, b: string) {
    return readFileSync(a).equals(readFileSync(b));
}

describe("serving the pdf.js assets from the app", () => {
    it("publishes each directory at the path the viewer requests", () => {
        const requested = Object.values(PDF_VIEWER_ASSET_URLS).map((url) => url as string).sort();
        const published = PDF_VIEWER_ASSET_DIRECTORIES.map((name) => `/${PUBLIC_PDFJS_DIRECTORY}/${name}/`).sort();
        expect(requested).toEqual(published);
    });

    it("replaces only its own directories under public/pdfjs/", () => {
        // Every copy deletes its target first, so a target is never public/ or public/pdfjs/ itself.
        expect(publishedPdfViewerAssetsDirectory()).toBe(join(FRONTEND, "public", "pdfjs"));
        expect(PDF_VIEWER_ASSET_DIRECTORIES).toEqual(["standard_fonts", "wasm", "cmaps", "iccs"]);
    });

    it("finds each directory in the installed pdfjs-dist, with its licences", () => {
        const installed = installedPdfjsDirectory();
        expect(installed).toContain(join("node_modules", "pdfjs-dist"));
        expect(readdirSync(join(installed, "standard_fonts"))).toContain("LiberationSans-Regular.ttf");
        expect(readdirSync(join(installed, "wasm"))).toEqual(expect.arrayContaining(["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"]));
        expect(readdirSync(join(installed, "cmaps"))).toContain("UniJIS-UCS2-H.bcmap");
        expect(readdirSync(join(installed, "iccs"))).toContain("CGATS001Compat-v2-micro.icc");
        for (const name of ["standard_fonts", "wasm", "iccs"]) {
            expect(readdirSync(join(installed, name)).some((file) => file.startsWith("LICENSE"))).toBe(true);
        }
    });

    it("copies every installed file of every directory, byte for byte, and replaces stale files", () => {
        const installed = installedPdfjsDirectory();
        const published = join(temporaryDirectory(), "pdfjs");
        mkdirSync(join(published, "wasm"), { recursive: true });
        writeFileSync(join(published, "wasm", "old.wasm"), "stale");
        const counts: Record<string, number> = publishPdfViewerAssets(installed, published);
        for (const name of PDF_VIEWER_ASSET_DIRECTORIES) {
            const files = readdirSync(join(installed, name)).sort();
            expect(readdirSync(join(published, name)).sort()).toEqual(files);
            expect(counts[name]).toBe(files.length);
            for (const file of files) expect(sameBytes(join(published, name, file), join(installed, name, file))).toBe(true);
        }
        expect(existsSync(join(published, "wasm", "old.wasm"))).toBe(false);
    });

    it("leaves everything it does not publish alone", () => {
        const published = join(temporaryDirectory(), "pdfjs");
        mkdirSync(join(published, "other"), { recursive: true });
        writeFileSync(join(published, "other", "keep.txt"), "keep");
        writeFileSync(join(published, "keep.txt"), "keep");
        publishPdfViewerAssets(installedPdfjsDirectory(), published);
        expect(readFileSync(join(published, "other", "keep.txt"), "utf8")).toBe("keep");
        expect(readFileSync(join(published, "keep.txt"), "utf8")).toBe("keep");
    });

    it("refuses an empty or missing source instead of publishing nothing", () => {
        const empty = temporaryDirectory();
        expect(() => copyAssetDirectory(empty, join(temporaryDirectory(), "x"))).toThrow(/no files found/i);
        expect(() => copyAssetDirectory(join(empty, "missing"), join(temporaryDirectory(), "x"))).toThrow();
    });

    it("changes nothing when one of the sources is missing or empty", () => {
        const installed = temporaryDirectory();
        for (const name of PDF_VIEWER_ASSET_DIRECTORIES) {
            mkdirSync(join(installed, name));
            writeFileSync(join(installed, name, "file"), "x");
        }
        rmSync(join(installed, "iccs", "file"));
        const published = join(temporaryDirectory(), "pdfjs");
        mkdirSync(join(published, "standard_fonts"), { recursive: true });
        writeFileSync(join(published, "standard_fonts", "kept.ttf"), "kept");
        expect(() => publishPdfViewerAssets(installed, published)).toThrow(/no files found/i);
        expect(readdirSync(join(published, "standard_fonts"))).toEqual(["kept.ttf"]);
        rmSync(join(installed, "iccs"), { recursive: true });
        expect(() => publishPdfViewerAssets(installed, published)).toThrow();
        expect(readdirSync(join(published, "standard_fonts"))).toEqual(["kept.ttf"]);
    });

    it("keeps the published directory out of git and runs the copy before dev and build", () => {
        const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as { scripts: Record<string, string> };
        expect(manifest.scripts.predev).toContain("scripts/copyPdfViewerAssets.mjs");
        expect(manifest.scripts.prebuild).toContain("scripts/copyPdfViewerAssets.mjs");
        const ignore = readFileSync(join(FRONTEND, "..", ".gitignore"), "utf8").split("\n");
        expect(ignore).toContain(`/frontend/public/${PUBLIC_PDFJS_DIRECTORY}/`);
    });
});
