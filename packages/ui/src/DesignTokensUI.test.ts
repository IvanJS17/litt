import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// DesignTokensUI.css is the one place the web app and the Word add-in get
// their core design tokens from. It replaced a hand-copied add-in tokens.css
// guarded only by a "keep values in sync" comment, which drifted. These
// tests pin the structure that makes drift impossible: both entry
// stylesheets import the shared file, and neither redeclares one of its
// tokens (a local redeclaration would silently shadow the shared value).

// Vitest runs from frontend/; the files under test sit across the repository.
const repoRoot = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const SHARED = "packages/ui/styles/DesignTokensUI.css";
const WEB_ENTRY = "frontend/src/app/globals.css";
const ADDIN_ENTRY = "word-addin/src/taskpane/styles.css";
const ADDIN_BASE = "word-addin/src/shared/styles/tokens.css";

/** Every `--custom-property` declared anywhere in the stylesheet. */
function customProperties(css: string): Set<string> {
    const names = new Set<string>();
    postcss.parse(css).walkDecls(/^--/, (decl) => {
        names.add(decl.prop);
    });
    return names;
}

/** `@import` targets, in source order. */
function imports(css: string): string[] {
    const targets: string[] = [];
    postcss.parse(css).walkAtRules("import", (rule) => {
        targets.push(rule.params.replace(/^["']|["']$/g, ""));
    });
    return targets;
}

const sharedTokens = customProperties(read(SHARED));

describe("DesignTokensUI.css", () => {
    it("declares the theme mapping and both palettes", () => {
        const scopes = new Set<string>();
        postcss.parse(read(SHARED)).walkDecls(/^--/, (decl) => {
            const parent = decl.parent;
            if (parent?.type === "rule") scopes.add((parent as postcss.Rule).selector);
            if (parent?.type === "atrule") {
                const at = parent as postcss.AtRule;
                scopes.add(`@${at.name} ${at.params}`);
            }
        });
        expect([...scopes].sort()).toEqual([".dark", ":root", "@theme ", "@theme inline"]);
        // A parse that finds nothing would make every check below vacuous.
        expect(sharedTokens.size).toBeGreaterThan(50);
        expect(sharedTokens).toContain("--app-background");
        expect(sharedTokens).toContain("--color-app-surface");
    });

    it.each([
        [WEB_ENTRY, "../../../packages/ui/styles/DesignTokensUI.css"],
        [ADDIN_ENTRY, "../../../packages/ui/styles/DesignTokensUI.css"],
    ])("%s imports the shared tokens right after tailwindcss setup", (entry, target) => {
        const list = imports(read(entry));
        expect(list).toContain(target);
        expect(list.indexOf(target)).toBeGreaterThan(list.indexOf("tailwindcss"));
    });

    it("the add-in imports the shared tokens before its base layer", () => {
        const list = imports(read(ADDIN_ENTRY));
        expect(list.indexOf("../../../packages/ui/styles/DesignTokensUI.css"))
            .toBeLessThan(list.indexOf("../shared/styles/tokens.css"));
    });

    it.each([WEB_ENTRY, ADDIN_ENTRY, ADDIN_BASE])(
        "%s does not redeclare a shared token",
        (file) => {
            const shadowed = [...customProperties(read(file))].filter((name) =>
                sharedTokens.has(name),
            );
            expect(shadowed).toEqual([]);
        },
    );
});

describe("the scale of surfaces", () => {
    const tokens = (selector: string) => {
        const out: Record<string, string> = {};
        postcss.parse(read(SHARED)).walkRules(selector, (rule) => {
            if (rule.parent?.type !== "root") return;
            rule.walkDecls(/^--/, (decl) => {
                out[decl.prop] = decl.value.replace(/\s+/g, " ").trim();
            });
        });
        return out;
    };
    const light = tokens(":root");
    const dark = tokens(".dark");
    const SURFACES = [
        "--surface-desk",
        "--surface-sheet",
        "--surface-float",
        "--surface-field",
        "--surface-document",
    ];

    it.each(SURFACES)("%s exists in the light and in the dark theme", (name) => {
        expect(light[name], `${name} in :root`).toBeDefined();
        expect(dark[name], `${name} in .dark`).toBeDefined();
    });

    it("the elevations exist in both themes and none has a white rim or glow", () => {
        for (const name of ["--elevation-sheet", "--elevation-float", "--elevation-document"]) {
            expect(light[name], name).toBeDefined();
            expect(dark[name], name).toBeDefined();
            expect(light[name]).not.toMatch(/255|white|inset/);
            expect(dark[name]).not.toMatch(/255 255 255|white|inset/);
        }
    });

    it("has the values of the approved scale", () => {
        expect(light["--surface-desk"]).toBe("var(--litt-papel)");
        expect(light["--surface-sheet"]).toBe("#fbfbf9");
        expect(light["--surface-field"]).toBe("#f4f4f0");
        expect(light["--surface-document"]).toBe("#ffffff");
        expect(dark["--surface-desk"]).toBe("var(--litt-tinta)");
        expect(dark["--surface-sheet"]).toBe("#1b202c");
        expect(dark["--surface-float"]).toBe("#1f2430");
        expect(dark["--surface-field"]).toBe("#2a2f3a");
        expect(dark["--surface-document"]).toBe("#ffffff");
    });

    it("the popover is no longer white, in either theme", () => {
        expect(light["--popover"]).not.toMatch(/^#f{3,6}$/i);
        expect(light["--popover"]).toBe("var(--surface-float)");
        expect(dark["--popover"]).toBe("var(--surface-float)");
    });

    it("the three near-whites are one: cards, the floating layer and the app surface are the hoja", () => {
        for (const name of ["--card", "--app-floating", "--app-surface"]) {
            expect(light[name], name).toBe("var(--surface-sheet)");
        }
        const near = /#fcfcfb|#f9f9f7|#fbfbf9/i;
        for (const name of Object.keys(light).filter((n) => !n.startsWith("--surface-"))) {
            expect(light[name], name).not.toMatch(near);
        }
    });

    it("the mesa is the page, the sidebar token and the app background", () => {
        for (const name of ["--background", "--app-background", "--sidebar"]) {
            expect(light[name], name).toBe("var(--surface-desk)");
            expect(dark[name], name).toBe("var(--surface-desk)");
        }
    });

    it("the field is secondary, muted, accent and the sidebar accent", () => {
        for (const name of ["--secondary", "--muted", "--accent", "--sidebar-accent"]) {
            expect(light[name], name).toBe("var(--surface-field)");
            expect(dark[name], name).toBe("var(--surface-field)");
        }
    });

    it("hover and pressed are the tinta tints, not a solid", () => {
        expect(light["--app-surface-hover"]).toBe("var(--litt-interactive-soft)");
        expect(light["--app-surface-active"]).toBe("var(--litt-interactive-soft-strong)");
    });

    it("the composer is the hoja and its menu the flotante, by name", () => {
        for (const scope of [light, dark]) {
            expect(scope["--litt-composer-surface"]).toBe("var(--surface-sheet)");
            expect(scope["--litt-composer-menu-surface"]).toBe("var(--surface-float)");
            expect(scope["--litt-composer-menu-shadow"]).toBe("var(--elevation-float)");
        }
    });

    it("Tailwind knows them: bg-surface-* and shadow-elev-*", () => {
        const css = read(SHARED);
        for (const name of ["desk", "sheet", "float", "field", "document"]) {
            expect(css).toContain(`--color-surface-${name}: var(--surface-${name});`);
        }
        for (const name of ["sheet", "float", "document"]) {
            expect(css).toContain(`--shadow-elev-${name}: var(--elevation-${name});`);
        }
    });
});

describe("LiquidGlassUI.css", () => {
    const css = read("packages/ui/styles/LiquidGlassUI.css");
    // The declarations of a top-level block, without its comments.
    const block = (selector: string) => {
        const lines: string[] = [];
        postcss.parse(css).walkRules(selector, (rule) => {
            if (rule.parent?.type !== "root") return;
            rule.walkDecls((decl) => {
                lines.push(`${decl.prop}: ${decl.value.replace(/\s+/g, " ")}`);
            });
        });
        return lines.join(";\n");
    };

    it("has no white in the light block", () => {
        const lightBlock = block(":root");
        expect(lightBlock.length).toBeGreaterThan(400);
        expect(lightBlock).not.toContain("rgba(255, 255, 255");
        expect(lightBlock).not.toMatch(/#fff(fff)?\b|\bwhite\b/i);
    });

    it("has no white glow in the dark block either", () => {
        expect(block(".dark")).not.toContain("rgba(255, 255, 255");
    });

    it("the translucent set is the hoja at 88 %, not white", () => {
        const lightBlock = block(":root");
        expect(lightBlock).toContain("--liquid-glass-translucent-background: rgb(251 251 249 / 88%)");
        expect(block(".dark")).toContain("--liquid-glass-translucent-background: rgb(27 32 44 / 88%)");
    });

    it("the light glass is opaque, and its edge is the shadow's, not a border", () => {
        const lightBlock = block(":root");
        for (const tier of ["flat", "subtle", "float", "modal"]) {
            expect(lightBlock).toContain(`--liquid-glass-border-${tier}: transparent`);
        }
        expect(lightBlock).toContain("--liquid-glass-background-subtle: var(--surface-sheet)");
        expect(lightBlock).toContain("--liquid-glass-shadow-flat: var(--elevation-sheet)");
        expect(lightBlock).toContain("--liquid-glass-shadow-float: var(--elevation-float)");
    });

    it("the dark palette maps bg-white and bg-gray-50 to the hoja", () => {
        const dark = read("packages/ui/styles/DarkPaletteUI.css");
        expect(dark).not.toContain("#181d29");
        expect(dark).not.toContain("rgba(27, 32, 44, 0.9)");
        expect(dark).toMatch(/\.dark \.bg-gray-50\\\/80 \{\s*background-color: var\(--surface-sheet\);/);
    });
});
