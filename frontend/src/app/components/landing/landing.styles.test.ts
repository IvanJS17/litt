import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// The public start page (SPEC §13, acceptance 5 to 8; SPEC v2 §2.3 for the menu): the design system's
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

describe("the phone menu", () => {
    const root = postcss.parse(css);
    const rule = (selector: string) => {
        let found: postcss.Rule | undefined;
        root.walkRules((r) => {
            if (r.selector.replace(/\s+/g, " ") === selector && !found) found = r;
        });
        return found;
    };
    const decl = (selector: string, prop: string) => {
        let value: string | undefined;
        rule(selector)?.walkDecls(prop, (d) => {
            value = d.value.replace(/\s+/g, " ");
        });
        return value;
    };

    it("moves with transitions, not keyframes, so a close in the middle can turn back", () => {
        expect(decl(".landing-menu", "transition")).toMatch(/clip-path 160ms/);
        expect(decl(".landing-scrim", "transition")).toMatch(/opacity 160ms/);
        expect(decl("html.menu-open .landing-menu", "transition-duration")).toBe("220ms");
        expect(decl("html.menu-open .landing-scrim", "transition-duration")).toBe("220ms");
        const keyframes: string[] = [];
        root.walkAtRules("keyframes", (at) => {
            keyframes.push(at.params);
        });
        expect(keyframes).toEqual(["landing-swap"]);
    });

    it("has no transition at all under reduced motion", () => {
        let silenced = "";
        root.walkAtRules("media", (at) => {
            if (at.params === "(prefers-reduced-motion: reduce)") silenced += at.toString();
        });
        expect(silenced).toMatch(/\.landing-menu/);
        expect(silenced).toMatch(/\.landing-scrim/);
        expect(silenced).toMatch(/\.landing-menu-bars span/);
        expect(silenced).toMatch(/transition: none !important/);
    });

    it("locks the page's scroll, keeps the panel's own and honors the safe areas", () => {
        expect(rule("html.menu-open, html.menu-open body")).toBeDefined();
        expect(decl("html.menu-open, html.menu-open body", "overflow")).toBe("hidden");
        expect(decl(".landing-menu", "overscroll-behavior")).toBe("contain");
        expect(decl(".landing-menu", "overflow-y")).toBe("auto");
        expect(decl(".landing-menu", "max-height")).toBe("calc(100dvh - 100%)");
        expect(decl(".landing-menu", "padding-block")).toMatch(/env\(safe-area-inset-bottom\)/);
        expect(decl(".landing-scrim", "touch-action")).toBe("none");
    });

    it("hides the closed panel and the backdrop, and its rows are 56 px high", () => {
        expect(decl(".landing-menu[hidden]", "display")).toBe("none");
        expect(decl(".landing-scrim[hidden]", "display")).toBe("none");
        expect(decl(".landing-menu-link", "min-height")).toBe("56px");
    });

    it("sits under the sticky header and over the page", () => {
        expect(decl(".landing-scrim", "z-index")).toBe("15");
        const header = readFileSync(join(HERE, "LandingHeader.tsx"), "utf8");
        expect(header).toMatch(/sticky top-0 z-20/);
    });

    it("hands hover only to a fine pointer", () => {
        let hover = "";
        root.walkAtRules("media", (at) => {
            if (at.params === "(hover: hover) and (pointer: fine)") hover += at.toString();
        });
        expect(hover).toMatch(/\.landing-menu-link:hover/);
        expect(css).not.toMatch(/^\.landing-menu-link:hover/m);
    });

    it("has a 44 px button with a name, state and the panel it controls", () => {
        const header = readFileSync(join(HERE, "LandingHeader.tsx"), "utf8");
        expect(header).toMatch(/size-11[^"]*min-\[880px\]:hidden|min-\[880px\]:hidden[^"]*size-11/);
        expect(header).toMatch(/aria-expanded=\{open\}/);
        expect(header).toMatch(/aria-controls=\{MENU_ID\}/);
        expect(header).toMatch(/aria-label=\{t\("landing\.header\.menu"\)\}/);
    });
});
