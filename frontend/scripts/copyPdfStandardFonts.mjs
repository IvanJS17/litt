// Publishes the standard fonts of the installed pdfjs-dist under public/, so the
// PDF viewer reads them from the app's own origin (STANDARD_FONT_DATA_URL in
// src/app/components/shared/views/highlightQuote.ts). Run by `predev` and
// `prebuild`; the target directory is git-ignored, so the files always match
// the installed library and no binary is committed.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory of public/ the fonts go to; the viewer asks for `/${this}/`. */
export const PUBLIC_FONT_DIRECTORY = "standard_fonts";

export function installedStandardFontsDirectory() {
    const manifest = createRequire(join(frontend, "package.json")).resolve("pdfjs-dist/package.json");
    return join(dirname(manifest), "standard_fonts");
}

/** Replaces `target` with a copy of every file in `source`; returns the names copied. */
export function copyStandardFonts(source, target) {
    const names = readdirSync(source).filter((name) => statSync(join(source, name)).isFile());
    if (names.length === 0) throw new Error(`no standard fonts found in ${source}`);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const name of names) copyFileSync(join(source, name), join(target, name));
    return names;
}

/** Where the fonts are published: a directory of its own under public/, replaced on every run. */
export function publishedStandardFontsDirectory() {
    return join(frontend, "public", PUBLIC_FONT_DIRECTORY);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const target = publishedStandardFontsDirectory();
    const names = copyStandardFonts(installedStandardFontsDirectory(), target);
    if (!existsSync(join(target, "LiberationSans-Regular.ttf"))) throw new Error("standard fonts were not published");
    console.log(`pdf.js standard fonts: ${names.length} files in public/${PUBLIC_FONT_DIRECTORY}`);
}
