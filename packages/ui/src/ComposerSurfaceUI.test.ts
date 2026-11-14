import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import {
    COMPOSER_GHOST_BUTTON_CLASS,
    COMPOSER_GHOST_WEB_ICON_CLASS,
    COMPOSER_GHOST_WEB_SIZE_CLASS,
    COMPOSER_GHOST_WORD_SIZE_CLASS,
    COMPOSER_SURFACE_CLASS,
    COMPOSER_SURFACE_WEB_RADIUS_CLASS,
    COMPOSER_SURFACE_WORD_RADIUS_CLASS,
} from "./ComposerSurfaceUI.styles";

// Vitest runs from frontend/, so the shared stylesheet is one level up.
const cssText = readFileSync(
    resolve(process.cwd(), "..", "packages/ui/styles/DesignTokensUI.css"),
    "utf8",
);

function tokens(selector: string): Record<string, string> {
    const out: Record<string, string> = {};
    postcss.parse(cssText).walkRules(selector, (rule) => {
        rule.walkDecls(/^--litt-composer-/, (d) => {
            out[d.prop] = d.value;
        });
    });
    return out;
}

describe("the composer sheet", () => {
    it("is opaque, with the approved colors in both themes", () => {
        expect(tokens(":root")["--litt-composer-surface"]).toBe("#fbfbf9");
        expect(tokens(".dark")["--litt-composer-surface"]).toBe("#1b202c");
        expect(tokens(".dark")["--litt-composer-menu-surface"]).toBe("#1f2430");
    });

    it("has one soft shadow and a neutral focus ring, never amber", () => {
        for (const theme of [":root", ".dark"]) {
            const t = tokens(theme);
            expect(t["--litt-composer-ring"]).toMatch(/^rgb\(/);
            expect(t["--litt-composer-ring-focus"]).toMatch(/^rgb\(/);
            for (const value of Object.values(t)) {
                expect(value).not.toMatch(/ambar|amber|255 178 30|150 89 0/i);
            }
        }
    });

    it("draws the sheet, its focus ring and its caret without glass or amber", () => {
        let surface = "";
        postcss.parse(cssText).walkRules(/^\.litt-composer/, (rule) => {
            surface += `${rule.selector}{${rule.nodes.map(String).join(";")}}`;
        });
        expect(surface).toContain("box-shadow");
        expect(surface).toContain(":focus-within");
        expect(surface).toContain("caret-color: currentColor");
        expect(surface).not.toMatch(/backdrop-filter|blur|ambar|amber|--litt-accent|--focus-ring/);
        // Only the shadow animates, and not under reduced motion.
        expect(surface).toContain("transition: box-shadow 150ms");
        expect(surface).toMatch(/prefers-reduced-motion|transition: none/);
    });

    it("does not use the liquid glass classes", () => {
        expect(COMPOSER_SURFACE_CLASS).toBe("litt-composer");
        expect(COMPOSER_SURFACE_CLASS).not.toMatch(/glass/);
    });

    it("has concentric corners with the send button: 17, 20 and 18 px", () => {
        expect(COMPOSER_SURFACE_WEB_RADIUS_CLASS).toBe(
            "rounded-[17px] pointer-coarse:rounded-[20px]",
        );
        expect(COMPOSER_SURFACE_WORD_RADIUS_CLASS).toBe("rounded-[18px]");
        expect(COMPOSER_GHOST_WEB_SIZE_CLASS).toContain("rounded-[9px]");
        expect(COMPOSER_GHOST_WEB_SIZE_CLASS).toContain("pointer-coarse:rounded-[12px]");
        expect(COMPOSER_GHOST_WORD_SIZE_CLASS).toContain("rounded-[10px]");
    });
});

describe("COMPOSER_GHOST_BUTTON_CLASS", () => {
    const all = [
        COMPOSER_GHOST_BUTTON_CLASS,
        COMPOSER_GHOST_WEB_SIZE_CLASS,
        COMPOSER_GHOST_WEB_ICON_CLASS,
        COMPOSER_GHOST_WORD_SIZE_CLASS,
    ].join(" ");

    it("has no fill at rest, no amber and no raw color", () => {
        expect(COMPOSER_GHOST_BUTTON_CLASS).toContain("bg-transparent");
        expect(all).not.toMatch(/amber|ambar|focus:ring|bg-gray|bg-white|#[0-9a-f]{3,6}|rgba?\(/i);
    });

    it("rests at gray-500 (6:1), not the 3.1:1 gray-400", () => {
        expect(COMPOSER_GHOST_BUTTON_CLASS).toContain("text-gray-500");
        expect(all).not.toContain("text-gray-400");
    });

    it("tints on hover and when its menu is open, and is 30 px (40 with a finger)", () => {
        expect(COMPOSER_GHOST_BUTTON_CLASS).toContain("enabled:hover:bg-interactive-soft");
        expect(COMPOSER_GHOST_BUTTON_CLASS).toContain("aria-expanded:bg-interactive-soft-strong");
        expect(COMPOSER_GHOST_WEB_SIZE_CLASS).toContain("h-7.5");
        expect(COMPOSER_GHOST_WEB_SIZE_CLASS).toContain("pointer-coarse:h-10");
    });
});
