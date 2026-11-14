import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// The scale of surfaces (mesa, hoja, flotante, campo; docs/design-system.md,
// "Superficies de LiTT") must keep every pair of text and marks above WCAG 2.x
// on the surface it sits on. The values come from the stylesheets, so a token
// that drifts fails here. Colors with transparency are composited onto the
// surface before they are measured, as `contrastes.txt` of the proposal does.

const repoRoot = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

type Rgb = [number, number, number];
type Scope = Record<string, string>;

function declarations(css: string, selector: string, atRule?: string): Scope {
    const out: Scope = {};
    postcss.parse(css).walkRules((rule) => {
        if (rule.selector !== selector) return;
        const parent = rule.parent;
        const inAt = parent?.type === "atrule" ? `@${(parent as postcss.AtRule).name}` : undefined;
        if (inAt !== atRule) return;
        rule.walkDecls(/^--/, (decl) => {
            out[decl.prop] = decl.value.replace(/\s+/g, " ").trim();
        });
    });
    return out;
}

const tokensCss = read("packages/ui/styles/DesignTokensUI.css");
const grays = (() => {
    const out: Scope = {};
    postcss.parse(tokensCss).walkAtRules("theme", (rule) => {
        if (rule.params) return; // `@theme inline` is the mapping, not the scale
        rule.walkDecls(/^--color-gray-/, (decl) => {
            out[decl.prop.replace("--color-", "")] = decl.value.trim();
        });
    });
    return out;
})();

const light: Scope = declarations(tokensCss, ":root");
const dark: Scope = { ...light, ...declarations(tokensCss, ".dark") };

/** The dark theme remaps Tailwind's grays class by class (DarkPaletteUI.css). */
const darkGrays = (() => {
    const out: Scope = {};
    for (const match of read("packages/ui/styles/DarkPaletteUI.css").matchAll(
        /\.dark \.text-gray-(\d+) \{ color: (#[0-9a-f]{6}); \}/g,
    )) {
        out[`gray-${match[1]}`] = match[2];
    }
    // The group shares one declaration: `.text-black, .text-gray-950, .text-gray-900`.
    out["gray-900"] = "#ecece6";
    return out;
})();

function resolveValue(scope: Scope, value: string, depth = 0): string {
    const ref = /^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/.exec(value);
    if (!ref || depth > 8) return value;
    const next = scope[ref[1]] ?? ref[2];
    expect(next, `${value} is not defined`).toBeDefined();
    return resolveValue(scope, next!, depth + 1);
}

function parse(scope: Scope, value: string): { rgb: Rgb; alpha: number } {
    const v = resolveValue(scope, value);
    let match = /^#([0-9a-f]{6})$/i.exec(v);
    if (match) {
        const n = parseInt(match[1], 16);
        return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
    }
    match = /^rgba?\((\d+) (\d+) (\d+)(?: \/ (\d+(?:\.\d+)?)%)?\)$/.exec(v);
    if (match) {
        return {
            rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
            alpha: match[4] === undefined ? 1 : Number(match[4]) / 100,
        };
    }
    throw new Error(`Cannot read the color ${value} (${v})`);
}

function over(scope: Scope, value: string, background: Rgb): Rgb {
    const { rgb, alpha } = parse(scope, value);
    return rgb.map((c, i) => Math.round(c * alpha + background[i] * (1 - alpha))) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
    const [lr, lg, lb] = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgb, b: Rgb): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

type Theme = { name: string; scope: Scope; gray: (step: string) => string };
const THEMES: Theme[] = [
    { name: "light", scope: light, gray: (step) => grays[`gray-${step}`] },
    { name: "dark", scope: dark, gray: (step) => darkGrays[`gray-${step}`] },
];

describe.each(THEMES)("surfaces and text, $name theme", ({ scope, gray }) => {
    const surfaces: Array<[string, string]> = [
        ["hoja", "--surface-sheet"],
        ["mesa", "--surface-desk"],
    ];

    describe.each(surfaces)("on the %s", (_name, token) => {
        const bg = parse(scope, scope[token]).rgb;
        const tint = (value: string) => over(scope, value, bg);
        const text = (value: string, goal: number, label: string) =>
            it(`${label} is at least ${goal}:1`, () => {
                expect(contrast(parse(scope, value).rgb, bg), label).toBeGreaterThanOrEqual(goal);
            });
        const onTint = (fg: string, tintToken: string, goal: number, label: string) =>
            it(`${label} is at least ${goal}:1`, () => {
                const filled = tint(scope[tintToken]);
                expect(contrast(over(scope, fg, filled), filled), label).toBeGreaterThanOrEqual(goal);
            });

        // Titles of a group and the main text.
        text(gray("900"), 4.5, "title (gray-900)");
        text(gray("700"), 4.5, "label and note text (gray-700)");
        // The description (gray-600) and the optional or secondary text (gray-500).
        text(gray("600"), 4.5, "description (gray-600)");
        text(gray("500"), 4.5, "secondary text and Opcional (gray-500)");
        // The three labels of Settings (SettingsTag).
        text(scope["--litt-interactive"], 4.5, "Recomendado text (interactive)");
        text(scope["--litt-interactive-border"], 3, "Recomendado outline");
        onTint(gray("700"), "--litt-interactive-soft", 4.5, "scope label text on its tint");
        onTint(gray("500"), "--litt-interactive-soft", 3, "scope label icon on its tint");
        // The rules of the notices: 3:1 or more.
        text(scope["--litt-note-rule"], 3, "note rule");
        text(scope["--litt-danger-rule"], 3, "irreversible rule");
        // The lead of the irreversible notice: 4.5:1 or more.
        text(scope["--litt-danger-text"], 4.5, "irreversible lead");
        // Keyboard focus and what it must stay readable on.
        text(scope["--litt-accent"], 3, "focus amber");
        onTint(scope["--litt-accent"], "--litt-interactive-soft", 3, "focus amber on a soft fill");
        onTint(scope["--litt-accent"], "--litt-interactive-soft-strong", 3, "focus amber on a selected fill");
        // A selected row keeps its text.
        onTint(scope["--litt-interactive"], "--litt-interactive-soft-strong", 4.5, "selected row text");
    });

    it("the hoja still separates from the mesa by its edge (a 1 px ring, not by tone alone)", () => {
        const sheet = parse(scope, scope["--surface-sheet"]).rgb;
        const desk = parse(scope, scope["--surface-desk"]).rgb;
        expect(contrast(sheet, desk)).toBeGreaterThan(1.05);
        expect(scope["--elevation-sheet"]).toMatch(/^0 0 0 1px rgb\(/);
    });

    it("the field reads against the hoja", () => {
        const sheet = parse(scope, scope["--surface-sheet"]).rgb;
        const field = parse(scope, scope["--surface-field"]).rgb;
        expect(contrast(field, sheet)).toBeGreaterThan(1.05);
    });
});

describe("the figures of the proposal", () => {
    it("tinta on the hoja is 16.78:1 and on the mesa 14.66:1 (light)", () => {
        const tinta = parse(light, light["--litt-tinta"]).rgb;
        expect(contrast(tinta, parse(light, light["--surface-sheet"]).rgb)).toBeCloseTo(16.78, 1);
        expect(contrast(tinta, parse(light, light["--surface-desk"]).rgb)).toBeCloseTo(14.66, 1);
    });

    it("papel on the hoja is 13.73:1 and on the mesa 14.66:1 (dark)", () => {
        const papel = parse(dark, dark["--litt-papel"]).rgb;
        expect(contrast(papel, parse(dark, dark["--surface-sheet"]).rgb)).toBeCloseTo(13.73, 1);
        expect(contrast(papel, parse(dark, dark["--surface-desk"]).rgb)).toBeCloseTo(14.66, 1);
    });

    it("the focus amber on the hoja is 5.44:1 (light) and 9.03:1 (dark)", () => {
        expect(
            contrast(parse(light, light["--litt-accent"]).rgb, parse(light, light["--surface-sheet"]).rgb),
        ).toBeCloseTo(5.44, 1);
        expect(
            contrast(parse(dark, dark["--litt-accent"]).rgb, parse(dark, dark["--surface-sheet"]).rgb),
        ).toBeCloseTo(9.03, 1);
    });
});
