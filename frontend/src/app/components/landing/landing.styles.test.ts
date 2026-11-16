import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// The public start page (SPEC §13, acceptance 5 to 8): the design system's
// rules, checked on its own files.

const HERE = __dirname;
const REPO = resolve(HERE, "../../../../..");
const css = readFileSync(join(HERE, "landing.css"), "utf8");
const tokens = readFileSync(join(REPO, "packages/ui/styles/DesignTokensUI.css"), "utf8");

function declarations(source: string, selector: string): Record<string, string> {
    const out: Record<string, string> = {};
    postcss.parse(source).walkRules((rule) => {
        if (rule.selector.replace(/\s+/g, " ") !== selector) return;
        rule.walkDecls(/^--/, (d) => {
            out[d.prop] = d.value.replace(/\s+/g, " ").trim();
        });
    });
    return out;
}

const sources = readdirSync(HERE)
    .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f))
    .map((f) => ({ file: f, text: readFileSync(join(HERE, f), "utf8") }))
    .concat([{ file: "../../page.tsx", text: readFileSync(join(HERE, "../../page.tsx"), "utf8") }]);

describe("the inverted band", () => {
    const light = declarations(tokens, ":root");
    const dark = declarations(tokens, ".dark");

    it("on a light page takes the dark theme's tokens, value for value", () => {
        const band = declarations(css, ":root:not(.dark) .landing-band");
        expect(Object.keys(band).length).toBeGreaterThan(8);
        for (const [name, value] of Object.entries(band)) {
            expect(dark[name], name).toBe(value);
        }
    });

    it("on a dark page takes the light theme's tokens, value for value", () => {
        const band = declarations(css, ":root.dark .landing-band");
        expect(Object.keys(band).length).toBeGreaterThan(8);
        for (const [name, value] of Object.entries(band)) {
            expect(light[name], name).toBe(value);
        }
    });

    it("reassigns the same tokens in both directions", () => {
        const a = Object.keys(declarations(css, ":root:not(.dark) .landing-band")).sort();
        const b = Object.keys(declarations(css, ":root.dark .landing-band")).sort();
        expect(a).toEqual(b);
    });
});

describe("motion", () => {
    it("every animation of the page is inside prefers-reduced-motion: no-preference", () => {
        const outside: string[] = [];
        postcss.parse(css).walkDecls(/^animation/, (d) => {
            const at = d.parent?.parent;
            const guarded =
                at?.type === "atrule" &&
                (at as postcss.AtRule).name === "media" &&
                (at as postcss.AtRule).params === "(prefers-reduced-motion: no-preference)";
            if (!guarded) outside.push(`${(d.parent as postcss.Rule).selector}: ${d.prop}`);
        });
        expect(outside).toEqual([]);
    });

    it("smooth scrolling is only for people who did not ask for less motion", () => {
        let found = false;
        postcss.parse(css).walkDecls("scroll-behavior", (d) => {
            found = true;
            expect((d.parent?.parent as postcss.AtRule).params).toBe("(prefers-reduced-motion: no-preference)");
        });
        expect(found).toBe(true);
    });

    it("never uses `transition: all`", () => {
        for (const { file, text } of sources) expect(text, file).not.toMatch(/transition-all|transition:\s*all/);
    });
});

describe("palette", () => {
    it("has no blue, no raw amber, orange or green in the page's files", () => {
        const forbidden =
            /\b(?:blue|indigo|violet|purple|sky|cyan)-[0-9]{2,3}\b|\bamber-|\borange-|\bgreen-|\bemerald-/;
        for (const { file, text } of sources) expect(text, file).not.toMatch(forbidden);
    });

    it("writes no hex color in a component: the colors are tokens", () => {
        for (const { file, text } of sources) {
            if (file === "landing.css") continue; // the band reassigns tokens, tested above
            const code = text.replace(/\/\*[\s\S]*?\*\/|^\s*(\/\/|\*).*$/gm, "");
            expect(code.match(/#[0-9a-fA-F]{6}\b/g) ?? [], file).toEqual([]);
        }
    });

    it("puts amber only in the focus ring: no component names an amber token", () => {
        for (const { file, text } of sources) {
            if (file === "landing.css") continue; // the band's own focus color
            expect(text.replace(/\/\*[\s\S]*?\*\//g, ""), file).not.toMatch(/ambar|--litt-ambar/);
        }
        // The CSS names them only to give the band the focus ring of its own background.
        const ambar = [...css.matchAll(/--litt-ambar-[a-z]+/g)].length;
        expect(ambar).toBe(2);
        expect(css).toMatch(/--litt-accent: var\(--litt-ambar-fosforo\)/);
        expect(css).toMatch(/--litt-accent: var\(--litt-ambar-tinta\)/);
    });

    it("sets the Departure Mono details in one place, at 11 px", () => {
        const users = sources.filter(({ text }) => /font-pixel|PIXEL_TEXT_CLASS/.test(text));
        expect(users.map((u) => u.file)).toEqual(["landingStyles.ts"]);
    });
});
