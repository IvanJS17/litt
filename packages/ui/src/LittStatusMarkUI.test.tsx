import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    LITT_STATUS_MARK_HUES,
    LITT_STATUS_MARK_STATES,
    LittStatusMarkUI,
    littStatusMarkGeometry,
} from "./LittStatusMarkUI";

// Vitest runs from frontend/, so the shared stylesheet is one level up.
const css = readFileSync(
    resolve(process.cwd(), "..", "packages/ui/styles/DesignTokensUI.css"),
    "utf8",
);

const mark = (c: HTMLElement) => c.querySelector("svg.litt-status-mark")!;
const rect = (c: HTMLElement, cls: string) => c.querySelector(`.${cls}`)!;

describe("LittStatusMarkUI", () => {
    it.each(LITT_STATUS_MARK_STATES)("renders the %s state", (state) => {
        const { container } = render(<LittStatusMarkUI state={state} />);
        expect(mark(container)).toHaveAttribute("data-state", state);
        expect(mark(container)).toHaveAttribute("aria-hidden", "true");
    });

    it("defaults to idle at 22 px", () => {
        const { container } = render(<LittStatusMarkUI />);
        expect(mark(container)).toHaveAttribute("data-state", "idle");
        expect(mark(container)).toHaveAttribute("width", "22");
    });

    it.each([
        [14, 2, 6],
        [16, 2, 6],
        [22, 3, 9],
        [24, 3, 9],
        [32, 4, 12],
    ])("snaps %i px to u=%i and a %i px square", (size, u, square) => {
        const { container } = render(<LittStatusMarkUI size={size} />);
        expect(littStatusMarkGeometry(size)).toMatchObject({ u, square });
        expect(rect(container, "lsm-square")).toHaveAttribute("width", String(square));
        expect(rect(container, "lsm-rule")).toHaveAttribute("height", String(u));
        // The rule sits 1u under the square.
        const g = littStatusMarkGeometry(size);
        expect(g.ruleY).toBe(g.y + g.square + u);
        expect(g.ruleY + u).toBeLessThanOrEqual(size);
    });

    it("fits three dots, 1u wide with a 1u gap, inside the box at every size", () => {
        for (const size of [14, 16, 22, 24, 32]) {
            const { container, unmount } = render(<LittStatusMarkUI size={size} />);
            const dots = [...container.querySelectorAll(".lsm-dot")];
            expect(dots).toHaveLength(3);
            const xs = dots.map((d) => Number(d.getAttribute("x")));
            const u = littStatusMarkGeometry(size).u;
            expect(xs[1] - xs[0]).toBe(2 * u);
            expect(xs[0]).toBeGreaterThanOrEqual(0);
            expect(xs[2] + u).toBeLessThanOrEqual(size);
            unmount();
        }
    });

    it("draws the error outline as a hollow frame of ceil(u/2)", () => {
        const { container } = render(<LittStatusMarkUI state="error" size={22} />);
        const d = rect(container, "lsm-outline").getAttribute("d")!;
        expect(d).toContain("h9v9h-9Z");
        expect(d).toContain("h5v-5"); // inner hole 9 - 2*2
    });

    it.each(LITT_STATUS_MARK_HUES)("tints a %s subagent mark", (hue) => {
        const { container } = render(<LittStatusMarkUI hue={hue} size={14} />);
        expect(mark(container)).toHaveAttribute("data-hue", hue);
        expect((mark(container) as SVGElement).style.getPropertyValue("--litt-status-hue")).toBe(
            `var(--litt-status-hue-${hue})`,
        );
    });

    it("has no tint by default, so the square takes the mark accent", () => {
        const { container } = render(<LittStatusMarkUI />);
        expect(mark(container)).not.toHaveAttribute("data-hue");
        expect(css).toMatch(/\.lsm-square \{\s*fill: var\(--litt-status-hue, var\(--litt-mark-accent\)\)/);
    });

    it("lists the four subagent hues without amber", () => {
        expect(LITT_STATUS_MARK_HUES).toEqual(["teal", "pink", "lime", "stone"]);
    });
});

describe("status mark styles (DesignTokensUI.css)", () => {
    const token = (name: string, scope: "light" | "dark") => {
        const block = scope === "dark" ? css.slice(css.indexOf("\n.dark {")) : css.slice(0, css.indexOf("\n.dark {"));
        return new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block)?.[1].toLowerCase();
    };

    it("blinks the cursor 1 → 0.2 in 1200 ms while working", () => {
        expect(css).toMatch(/\[data-state="working"\] \.lsm-square \{\s*animation: lsm-blink 1200ms linear infinite/);
        expect(css).toMatch(/50%, 95% \{ opacity: 0\.2; \}/);
    });

    it("draws the done rule in 7 steps of 30 ms in green and holds 1.5 s", () => {
        expect(css).toMatch(/\[data-state="done"\] \.lsm-rule \{\s*fill: var\(--litt-status-done\)/);
        expect(css).toContain("lsm-draw 210ms steps(7, jump-end)");
        expect(css).toContain("lsm-leave 160ms cubic-bezier(0.23, 1, 0.32, 1) 1710ms");
    });

    it("dims the waiting square and forms the dots one by one, slower than the done stroke", () => {
        expect(css).toMatch(/\[data-state="waiting"\] \.lsm-square \{\s*opacity: 0\.55/);
        expect(css).toContain("lsm-dot 1800ms linear infinite");
        expect(css).toContain("25%, 83% { opacity: 0.55; }");
        expect(css).toContain("50%, 83% { opacity: 0.55; }");
    });

    it("keeps only the gray outline on error", () => {
        expect(css).toMatch(/\[data-state="error"\] \.lsm-square \{\s*opacity: 0;/);
        expect(css).toMatch(/\[data-state="error"\] \.lsm-outline \{\s*opacity: 1;/);
    });

    it("stops every animation under prefers-reduced-motion and keeps the states apart", () => {
        const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n    .litt-status-mark"));
        expect(rm).toContain("animation: none !important");
        expect(rm).toContain("transition: none !important");
        expect(rm).toMatch(/\[data-state="working"\] \.lsm-lead \{\s*opacity: 1/);
        expect(rm).toMatch(/\[data-state="waiting"\] \.lsm-dot \{\s*opacity: 0\.55/);
        expect(rm).toMatch(/\[data-state="done"\] \.lsm-rule \{\s*opacity: 1/);
    });

    it("defines the done green and the four hues for both themes", () => {
        expect(token("--litt-status-done", "light")).toBe("#047857");
        expect(token("--litt-status-done", "dark")).toBe("#34d399");
        const light = { teal: "#0f766e", pink: "#db2777", lime: "#4d7c0f", stone: "#78716c" };
        const dark = { teal: "#2dd4bf", pink: "#f472b6", lime: "#a3e635", stone: "#a8a29e" };
        for (const hue of LITT_STATUS_MARK_HUES) {
            expect(token(`--litt-status-hue-${hue}`, "light")).toBe(light[hue]);
            expect(token(`--litt-status-hue-${hue}`, "dark")).toBe(dark[hue]);
        }
    });
});
