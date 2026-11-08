import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

// Warnings read the shared warning tokens (packages/ui/styles/
// DesignTokensUI.css), so the web app and the Word add-in show the same
// color in both themes. A raw Tailwind orange or amber class in a notice
// skips the dark-theme value, which is how the add-in's "Set up API keys"
// button ended up saturated orange with white text at 3.54:1.

const repoRoot = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const NOTICES = [
    "word-addin/src/taskpane/components/shell/ApiKeyBanner.tsx",
    "packages/ui/src/NoticeCardUI.tsx",
    "frontend/src/app/components/popups/WarningPopup.tsx",
    "frontend/src/app/components/popups/ApiKeyMissingPopup.tsx",
    "frontend/src/app/components/memory/MemoryEditorState.tsx",
    "frontend/src/app/components/playbooks/PlaybookRuleForm.tsx",
    "frontend/src/app/components/playbooks/PlaybookRuns.tsx",
    "frontend/src/app/components/playbooks/PlaybooksWorkspace.tsx",
    "frontend/src/app/components/shared/DocumentSidePanel.tsx",
];

// Notice surfaces only: status dots and categorical palettes (tags, avatars,
// column formats) keep their own hues and are not listed above.
const RAW_WARM = /\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:orange|amber)-\d{2,3}\b/g;

function tokens(selector: string): Record<string, string> {
    const out: Record<string, string> = {};
    postcss
        .parse(read("packages/ui/styles/DesignTokensUI.css"))
        .walkRules((rule) => {
            if (rule.selector !== selector) return;
            rule.walkDecls(/^--litt-/, (decl) => {
                out[decl.prop] = decl.value.trim();
            });
        });
    return out;
}

const light = tokens(":root");
const dark = { ...light, ...tokens(".dark") };

function hex(scope: Record<string, string>, name: string): string {
    let value = scope[name];
    const ref = /^var\((--[\w-]+)\)$/.exec(value ?? "");
    if (ref) value = scope[ref[1]];
    expect(value, name).toMatch(/^#[0-9a-f]{6}$/i);
    return value;
}

function luminance(color: string): number {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(color.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe("warning palette", () => {
    it.each(NOTICES)("%s uses the warning tokens, not raw orange or amber", (path) => {
        expect(read(path).match(RAW_WARM) ?? []).toEqual([]);
    });

    it("the add-in's API key banner reads the warning tokens", () => {
        const banner = read(NOTICES[0]);
        expect(banner).toContain("bg-warning-surface");
        expect(banner).toContain("bg-warning-fill");
        expect(banner).toContain("text-warning-fill-foreground");
    });

    it("catches the classes it forbids", () => {
        expect("bg-orange-600 text-amber-700".match(RAW_WARM)).toHaveLength(2);
        expect("bg-warning-fill text-orange".match(RAW_WARM)).toBeNull();
    });

    it.each([
        ["light", light],
        ["dark", dark],
    ] as const)("meets AA on the %s theme", (_, scope) => {
        expect(
            contrast(hex(scope, "--litt-warning"), hex(scope, "--litt-warning-surface")),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            contrast(
                hex(scope, "--litt-warning-fill-foreground"),
                hex(scope, "--litt-warning-fill"),
            ),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
            contrast(
                hex(scope, "--litt-warning-fill-foreground"),
                hex(scope, "--litt-warning-fill-hover"),
            ),
        ).toBeGreaterThanOrEqual(4.5);
    });

    it("keeps warnings off the brand ambers", () => {
        for (const scope of [light, dark]) {
            for (const name of ["--litt-warning", "--litt-warning-fill"]) {
                expect(hex(scope, name).toLowerCase()).not.toMatch(/^#(ffb21e|965900)$/);
            }
        }
    });
});
