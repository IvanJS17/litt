import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// LiTT's own icons stay inside the brand palette (DESIGN.md, Marca LiTT
// v1.0): tinta, papel and the two ambers, with their tints. Blue and cyan
// are never used; red and orange are kept for errors and never decorate;
// green is kept for success, so only an icon that means "done"
// (`*-complete.svg`) may carry it. Third-party marks keep their own
// colors and are left out: AI provider logos, the Office and PDF file
// types, and the integrations' raster logos.

const ICONS = resolve(process.cwd(), "public/icons");

const THIRD_PARTY = [
    /^providers\//,
    /^integrations\//,
    /^file-types\/(word|excel|ppt|pdf)\.svg$/,
];

function svgFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return svgFiles(path);
        return entry.name.endsWith(".svg") ? [path] : [];
    });
}

/** Every #rgb / #rrggbb color in the file. */
function hexColors(svg: string): string[] {
    return [...svg.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => {
        const hex = m[1];
        return hex.length === 3
            ? hex.split("").map((c) => c + c).join("")
            : hex;
    });
}

/** Hue in degrees and saturation/lightness in 0..1. */
function hsl(hex: string) {
    const [r, g, b] = [0, 2, 4].map(
        (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
    );
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    const h =
        max === r
            ? 60 * (((g - b) / d) % 6)
            : max === g
              ? 60 * ((b - r) / d + 2)
              : 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, s, l };
}

// Grays and near-grays (the tinta ramp has a slight blue cast: #151A26 is
// hue 225, saturation 0.29) are not a color; a hue only counts once it is
// clearly saturated.
const chromatic = ({ s, l }: ReturnType<typeof hsl>) =>
    s >= 0.35 && l > 0.08 && l < 0.97;
const isBlueOrCyan = (c: ReturnType<typeof hsl>) =>
    chromatic(c) && c.h >= 170 && c.h <= 260;
const isGreen = (c: ReturnType<typeof hsl>) =>
    chromatic(c) && c.h >= 85 && c.h < 170;
// Red and orange belong to errors, so they never decorate an icon. Both
// ambers sit at hue 35-40 (ámbar tinta #965900 is 35.6), above this band.
const isRedOrOrange = (c: ReturnType<typeof hsl>) =>
    chromatic(c) && (c.h < 33 || c.h >= 330);

const own = svgFiles(ICONS)
    .map((path) => relative(ICONS, path).replaceAll("\\", "/"))
    .filter((name) => !THIRD_PARTY.some((pattern) => pattern.test(name)));

describe("LiTT icon palette", () => {
    it("finds the icons it guards", () => {
        // A wrong path would make every check below pass vacuously.
        expect(own.length).toBeGreaterThan(20);
        expect(own).toContain("features/library-new.svg");
        expect(own).toContain("file-types/chat.svg");
    });

    it("classifies the palette and the colors it forbids", () => {
        expect(isBlueOrCyan(hsl("151a26"))).toBe(false); // tinta
        expect(isBlueOrCyan(hsl("2588f0"))).toBe(true);
        expect(isBlueOrCyan(hsl("7dd3fc"))).toBe(true);
        expect(isGreen(hsl("059669"))).toBe(true);
        expect(isGreen(hsl("ffb21e"))).toBe(false); // ámbar fósforo
        expect(isGreen(hsl("965900"))).toBe(false); // ámbar tinta
        expect(isRedOrOrange(hsl("ef4444"))).toBe(true);
        expect(isRedOrOrange(hsl("b45309"))).toBe(true);
        expect(isRedOrOrange(hsl("ffb21e"))).toBe(false);
        expect(isRedOrOrange(hsl("965900"))).toBe(false);
    });

    it.each(own)("%s uses no decorative red or orange", (name) => {
        const svg = readFileSync(join(ICONS, name), "utf8");
        expect(
            hexColors(svg).filter((hex) => isRedOrOrange(hsl(hex))),
        ).toEqual([]);
    });

    it.each(own)("%s uses no blue or cyan", (name) => {
        const svg = readFileSync(join(ICONS, name), "utf8");
        expect(hexColors(svg).filter((hex) => isBlueOrCyan(hsl(hex)))).toEqual(
            [],
        );
    });

    it.each(own)("%s names no gradient after a forbidden hue", (name) => {
        const svg = readFileSync(join(ICONS, name), "utf8");
        const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
        expect(
            ids.filter((id) => /blue|purple|indigo|violet|cyan|sky/i.test(id)),
        ).toEqual([]);
    });

    it.each(own.filter((name) => !name.endsWith("-complete.svg")))(
        "%s keeps green for success icons",
        (name) => {
            const svg = readFileSync(join(ICONS, name), "utf8");
            expect(hexColors(svg).filter((hex) => isGreen(hsl(hex)))).toEqual(
                [],
            );
        },
    );
});
