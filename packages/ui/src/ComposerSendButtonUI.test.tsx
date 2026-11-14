import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { COMPOSER_SEND_BUTTON_CLASS } from "./ComposerSendButtonUI.styles";
import { SEND_ARROW_PATH, SendArrowUI } from "./SendArrowUI";

// Vitest runs from frontend/, so the shared stylesheet is one level up.
const cssText = readFileSync(
    resolve(process.cwd(), "..", "packages/ui/styles/DesignTokensUI.css"),
    "utf8",
);

function tokens(selector: string): Record<string, string> {
    const out: Record<string, string> = {};
    postcss.parse(cssText).walkRules(selector, (rule) => {
        rule.walkDecls(/^--litt-send-/, (d) => {
            out[d.prop] = d.value;
        });
    });
    return out;
}

describe("COMPOSER_SEND_BUTTON_CLASS", () => {
    const classes = COMPOSER_SEND_BUTTON_CLASS.split(/\s+/);

    it("has no gradient, drop shadow or raw hex", () => {
        expect(COMPOSER_SEND_BUTTON_CLASS).not.toMatch(/gradient|from-|to-|#[0-9a-f]{3,6}|rgba?\(/i);
        expect(COMPOSER_SEND_BUTTON_CLASS).not.toMatch(/shadow-\[0_/);
    });

    it("covers disabled, ready, hover, press and reduced motion", () => {
        for (const c of [
            "bg-[var(--litt-send-bg)]",
            "text-[var(--litt-send-fg)]",
            "enabled:hover:bg-[var(--litt-send-bg-hover)]",
            "enabled:hover:shadow-[inset_0_0_0_1px_var(--litt-send-edge-hover)]",
            "active:enabled:scale-95",
            "disabled:bg-[var(--litt-send-bg-disabled)]",
            "disabled:text-[var(--litt-send-fg-disabled)]",
            "disabled:shadow-none",
            "motion-reduce:transition-none",
        ]) {
            expect(classes).toContain(c);
        }
    });

    it("light tokens: tinta, amber arrow, no edge; disabled gray", () => {
        const t = tokens(":root");
        expect(t["--litt-send-bg"]).toBe("var(--litt-tinta)");
        expect(t["--litt-send-fg"]).toBe("var(--litt-ambar-fosforo)");
        expect(t["--litt-send-stop"]).toBe("var(--litt-papel)");
        expect(t["--litt-send-bg-disabled"]).toBe("#e2e2dd");
        expect(t["--litt-send-fg-disabled"]).toBe("#8d9093");
        expect(t["--litt-send-edge"]).toBe("transparent");
    });

    it("dark tokens: papel edge at 24 %/40 %, washed disabled, no amber", () => {
        const t = tokens(".dark");
        expect(t["--litt-send-edge"]).toContain("var(--litt-papel) 24%");
        expect(t["--litt-send-edge-hover"]).toContain("var(--litt-papel) 40%");
        expect(t["--litt-send-bg-hover"]).toBe("#0e121b");
        expect(t["--litt-send-bg-disabled"]).toContain("var(--litt-papel) 8%");
        expect(t["--litt-send-fg-disabled"]).toContain("var(--litt-papel) 38%");
        // The fill and arrow stay the light theme's: the same in both themes.
        expect(t["--litt-send-bg"]).toBeUndefined();
        expect(t["--litt-send-fg"]).toBeUndefined();
    });

    it("amber appears only as the ready arrow", () => {
        const all = { ...tokens(":root"), ...tokens(".dark") };
        const amber = Object.entries(all)
            .filter(([, v]) => /ambar|ffb21e|965900/i.test(v))
            .map(([k]) => k);
        expect(amber).toEqual(["--litt-send-fg"]);
    });
});

describe("SendArrowUI", () => {
    it("draws the 7×7 README arrow at 14 px, hidden from assistive tech", () => {
        const { container } = render(<SendArrowUI />);
        const glyph = container.querySelector(".litt-send-glyph")!;
        expect(glyph).toHaveAttribute("aria-hidden", "true");
        expect(glyph).toHaveAttribute("data-stop", "false");
        const svg = container.querySelector("svg.lsg-arrow")!;
        expect(svg).toHaveAttribute("viewBox", "0 0 7 7");
        expect(svg).toHaveAttribute("width", "14");
        expect(svg.querySelector("path")).toHaveAttribute("d", SEND_ARROW_PATH);
        expect(SEND_ARROW_PATH).toBe(
            "M0 3h7v1H0z M3 0h1v1H3z M4 1h1v1H4z M5 2h1v1H5z M5 4h1v1H5z M4 5h1v1H4z M3 6h1v1H3z",
        );
    });

    it("rotates up for the citation menu", () => {
        const { container } = render(<SendArrowUI direction="up" />);
        const glyph = container.querySelector(".litt-send-glyph") as HTMLElement;
        expect(glyph.style.getPropertyValue("--lsg-rot")).toBe("-90deg");
    });

    it("Stop is a 10 px papel square, never amber", () => {
        const { container } = render(<SendArrowUI stop />);
        expect(container.querySelector(".litt-send-glyph")).toHaveAttribute("data-stop", "true");
        const rect = container.querySelector("svg.lsg-stop rect")!;
        expect(rect).toHaveAttribute("width", "10");
        expect(rect).toHaveAttribute("height", "10");
        expect(rect).toHaveAttribute("fill", "var(--litt-send-stop)");
    });

    it("styles: crisp edges, 160 ms ease-out, 2 px advance, no motion when reduced", () => {
        expect(cssText).toContain("shape-rendering: crispEdges");
        expect(cssText).toContain("160ms cubic-bezier(0.23, 1, 0.32, 1)");
        expect(cssText).toContain("translateX(2px)");
        const reduced = cssText.slice(cssText.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
        expect(reduced).toContain("transition: none");
    });
});
