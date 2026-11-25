// Publishes the asset directories pdf.js needs of the installed pdfjs-dist
// under public/pdfjs/, so the PDF viewer reads them from the app's own origin
// (PDF_VIEWER_ASSET_URLS in src/app/components/shared/views/highlightQuote.ts):
//   standard_fonts  substitutes for the 14 standard PDF fonts
//   wasm            CCITT, JBIG2 and JPEG 2000 image decoders, colour management
//   cmaps           character maps of CJK fonts that are not embedded
//   iccs            the ICC profile pdf.js uses for ICC-based colours
// Run by `predev` and `prebuild`; public/pdfjs/ is git-ignored, so the files
// always match the installed library and no binary is committed.
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory of public/ everything is published under; the viewer asks for `/${this}/<name>/`. */
export const PUBLIC_PDFJS_DIRECTORY = "pdfjs";

/** The directories of the installed pdfjs-dist that are published, each under its own name. */
export const PDF_VIEWER_ASSET_DIRECTORIES = ["standard_fonts", "wasm", "cmaps", "iccs"];

export function installedPdfjsDirectory() {
    const manifest = createRequire(join(frontend, "package.json")).resolve("pdfjs-dist/package.json");
    return dirname(manifest);
}

/** Replaces `target` with a copy of every file in `source`; returns the names copied. */
export function copyAssetDirectory(source, target) {
    const names = readdirSync(source).filter((name) => statSync(join(source, name)).isFile());
    if (names.length === 0) throw new Error(`no files found in ${source}`);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const name of names) copyFileSync(join(source, name), join(target, name));
    return names;
}

/** Publishes every asset directory of `installed` under `published/<name>`, replacing only those. */
export function publishPdfViewerAssets(installed, published) {
    // Check every source first, so a missing one does not leave a half-replaced set.
    for (const name of PDF_VIEWER_ASSET_DIRECTORIES) {
        if (readdirSync(join(installed, name)).length === 0) throw new Error(`no files found in ${join(installed, name)}`);
    }
    const counts = {};
    for (const name of PDF_VIEWER_ASSET_DIRECTORIES) {
        counts[name] = copyAssetDirectory(join(installed, name), join(published, name)).length;
    }
    return counts;
}

/** Where they are published: directories of their own under public/pdfjs/, replaced on every run. */
export function publishedPdfViewerAssetsDirectory() {
    return join(frontend, "public", PUBLIC_PDFJS_DIRECTORY);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const counts = publishPdfViewerAssets(installedPdfjsDirectory(), publishedPdfViewerAssetsDirectory());
    const summary = Object.entries(counts).map(([name, count]) => `${name} ${count}`).join(", ");
    console.log(`pdf.js assets in public/${PUBLIC_PDFJS_DIRECTORY}: ${summary}`);
}
