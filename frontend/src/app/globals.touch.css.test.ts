import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) =>
    readFileSync(join(__dirname, ...parts), "utf8");
const styles = (name: string) =>
    postcss.parse(read("..", "..", "..", "packages", "ui", "styles", name));
const globals = postcss.parse(read("globals.css"));

describe("hand-written :hover rules", () => {
    // After a tap the finger leaves the element "hovered" and a row stays
    // highlighted. Tailwind's own hover: variant is already restricted.
    it.each([
        ["ThemeTokensUI.css", styles("ThemeTokensUI.css")],
        ["LiquidGlassUI.css", styles("LiquidGlassUI.css")],
        ["DarkPaletteUI.css", styles("DarkPaletteUI.css")],
        ["globals.css", globals],
    ])("%s only applies :hover with a mouse", (_name, root) => {
        const bare: string[] = [];
        root.walkRules((rule) => {
            if (!rule.selector.includes(":hover")) return;
            let parent = rule.parent;
            let guarded = false;
            while (parent && parent.type !== "root") {
                if (
                    parent.type === "atrule" &&
                    (parent as postcss.AtRule).name === "media" &&
                    (parent as postcss.AtRule).params.includes("hover: hover") &&
                    (parent as postcss.AtRule).params.includes("pointer: fine")
                ) {
                    guarded = true;
                }
                parent = parent.parent;
            }
            if (!guarded) bare.push(rule.selector);
        });
        expect(bare).toEqual([]);
    });
});

describe("touch base in globals.css", () => {
    const css = read("globals.css");

    it("removes the Safari tap flash", () => {
        expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
    });

    it("sets touch-action: manipulation on controls", () => {
        expect(css).toMatch(/touch-action:\s*manipulation/);
    });

    it("blocks text selection and the callout on buttons only", () => {
        const rule = css.match(/\nbutton \{[^}]*\}/);
        expect(rule?.[0]).toMatch(/user-select:\s*none/);
        expect(rule?.[0]).toMatch(/-webkit-touch-callout:\s*none/);
    });

    it("stops the page rubber-band", () => {
        expect(css).toMatch(/html,\s*body \{\s*overscroll-behavior:\s*none/);
    });

    it("quiets every animation and transition under Reduce Motion", () => {
        const media = css.match(
            /@media \(prefers-reduced-motion: reduce\) \{\s*\*,[^}]*\}/,
        );
        expect(media?.[0]).toMatch(/animation-duration:\s*0\.01ms !important/);
        expect(media?.[0]).toMatch(/transition-duration:\s*0\.01ms !important/);
        expect(media?.[0]).toMatch(/scroll-behavior:\s*auto !important/);
    });
});

describe("Lote 2 · acabado", () => {
    it("skips drawing a settled chat message with an estimated, remembered height", () => {
        let found: postcss.Rule | undefined;
        globals.walkRules(".chat-message-settled", (rule) => {
            found = rule;
        });
        expect(found).toBeDefined();
        const decl = (prop: string) => found?.nodes?.find((n) => n.type === "decl" && n.prop === prop) as postcss.Declaration | undefined;
        expect(decl("content-visibility")?.value).toBe("auto");
        expect(decl("contain-intrinsic-size")?.value).toMatch(/^auto \d/);
    });
});
