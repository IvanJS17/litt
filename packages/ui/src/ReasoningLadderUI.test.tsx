import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import postcss from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelToggleUI, reasoningLevelsForModel, type ReasoningLevel } from "./ModelToggleUI";
import {
    LADDER_MOTION,
    ReasoningLadderUI,
    ReasoningMiniUI,
    ladderFilledSteps,
    ladderLevelForFilled,
    ladderStepCount,
    ladderStepHeight,
    ladderStepMotions,
} from "./ReasoningLadderUI";

const FOUR: readonly ReasoningLevel[] = reasoningLevelsForModel("claude-opus-5-5");
const WITH_NONE: readonly ReasoningLevel[] = ["none", "low", "medium", "high", "xhigh"];

function stepVars(container: HTMLElement, selector: string, name: string): string[] {
    return [...container.querySelectorAll<HTMLElement>(selector)].map((step) =>
        step.style.getPropertyValue(name),
    );
}

function mockReducedMotion(reduced: boolean): void {
    vi.stubGlobal(
        "matchMedia",
        (query: string) => ({
            matches: reduced && query.includes("prefers-reduced-motion"),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
        }),
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("the steps of a model", () => {
    it("are its levels without none", () => {
        expect(ladderStepCount(reasoningLevelsForModel("claude-opus-5-5"))).toBe(4);
        expect(ladderStepCount(reasoningLevelsForModel("claude-sonnet-5-5"))).toBe(4);
        expect(ladderStepCount(reasoningLevelsForModel("gpt-6.1"))).toBe(5);
        // Mistral Large 4 offers none and high: one step.
        expect(ladderStepCount(reasoningLevelsForModel("mistral-large-4"))).toBe(1);
    });

    it("fill from none (no step) up to the last level", () => {
        expect(ladderFilledSteps(WITH_NONE, "none")).toBe(0);
        expect(ladderFilledSteps(WITH_NONE, "low")).toBe(1);
        expect(ladderFilledSteps(WITH_NONE, "xhigh")).toBe(4);
        expect(ladderLevelForFilled(WITH_NONE, 0)).toBe("none");
        expect(ladderLevelForFilled(WITH_NONE, 3)).toBe("high");
        // A model that cannot disable thinking has no level for zero steps.
        expect(ladderLevelForFilled(FOUR, 0)).toBeUndefined();
    });

    it("rise 2 px per step: 6 to 12 px in the menu and 4 to 10 px beside the name", () => {
        expect([0, 1, 2, 3].map((i) => ladderStepHeight(i, 4, "menu"))).toEqual([6, 8, 10, 12]);
        expect([0, 1, 2, 3].map((i) => ladderStepHeight(i, 4, "mini"))).toEqual([4, 6, 8, 10]);
        expect(ladderStepHeight(0, 1, "menu")).toBe(12);
    });
});

describe("the ladder's motion", () => {
    it("fills bottom to top: 160 ms, 30 ms apart, the stagger capped at 90 ms", () => {
        const motions = ladderStepMotions(0, 4, 4, "menu", false);
        expect(motions.map((m) => m.duration)).toEqual([160, 160, 160, 160]);
        // 3 gaps of 30 ms is exactly the 90 ms cap.
        expect(motions.map((m) => m.delay)).toEqual([0, 30, 60, 90]);
        // Five steps would be 120 ms: the stagger shrinks to fit the cap.
        const five = ladderStepMotions(0, 5, 5, "menu", false);
        expect(five.at(-1)?.delay).toBeCloseTo(90);
    });

    it("empties from the top: 110 ms, 20 ms apart, capped at 60 ms", () => {
        const motions = ladderStepMotions(4, 0, 4, "menu", false);
        expect(motions.map((m) => m.duration)).toEqual([110, 110, 110, 110]);
        expect(motions.map((m) => m.delay)).toEqual([60, 40, 20, 0]);
    });

    it("moves only the steps that change", () => {
        const motions = ladderStepMotions(1, 3, 4, "menu", false);
        expect(motions.map((m) => m.duration)).toEqual([0, 160, 160, 0]);
    });

    it("has the thumbnail's own timings: 140 and 100 ms, 20 and 15 ms apart", () => {
        expect(LADDER_MOTION.mini.up).toMatchObject({ duration: 140, stagger: 20, cap: 60 });
        expect(LADDER_MOTION.mini.down).toMatchObject({ duration: 100, stagger: 15, cap: 45 });
        expect(ladderStepMotions(0, 4, 4, "mini", false).map((m) => m.delay)).toEqual([
            0, 20, 40, 60,
        ]);
        expect(ladderStepMotions(4, 0, 4, "mini", false).map((m) => m.delay)).toEqual([
            45, 30, 15, 0,
        ]);
    });

    it("is none at all when instant", () => {
        expect(
            ladderStepMotions(0, 4, 4, "menu", true).every((m) => m.duration === 0 && m.delay === 0),
        ).toBe(true);
    });
});

describe("ReasoningLadderUI", () => {
    function setup(level: ReasoningLevel = "medium", levels = WITH_NONE) {
        const onChange = vi.fn();
        const onPreview = vi.fn();
        const view = render(
            <ReasoningLadderUI
                levels={levels}
                level={level}
                onChange={onChange}
                onPreview={onPreview}
                label="Reasoning level"
                valueText="Medium"
            />,
        );
        const slider = screen.getByRole("slider", { name: "Reasoning level" });
        // jsdom has no layout: the ladder is 100 px wide, 25 px per step.
        slider.getBoundingClientRect = () =>
            ({ left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20 }) as DOMRect;
        return { ...view, slider, onChange, onPreview };
    }

    it("is a slider with one step per level and the right aria values", () => {
        const { slider, container } = setup("medium");
        expect(container.querySelectorAll(".litt-ladder-step")).toHaveLength(4);
        expect(slider).toHaveAttribute("aria-valuemin", "0");
        expect(slider).toHaveAttribute("aria-valuemax", "4");
        expect(slider).toHaveAttribute("aria-valuenow", "2");
        expect(slider).toHaveAttribute("aria-valuetext", "Medium");
        expect(slider).toHaveAttribute("aria-orientation", "horizontal");
        expect(slider).toHaveAttribute("tabindex", "0");
        const on = [...container.querySelectorAll(".litt-ladder-step")].map((s) =>
            s.getAttribute("data-on"),
        );
        expect(on).toEqual(["true", "true", "false", "false"]);
    });

    it("starts at one step when the model cannot turn reasoning off", () => {
        const { slider } = setup("low", FOUR);
        expect(slider).toHaveAttribute("aria-valuemin", "1");
        expect(slider).toHaveAttribute("aria-valuemax", "4");
        fireEvent.keyDown(slider, { key: "Home" });
        fireEvent.keyDown(slider, { key: "ArrowLeft" });
        // Already on the first step: nothing to choose below it.
        expect(slider).toHaveAttribute("aria-valuenow", "1");
    });

    it("moves with the arrows, Page Up and Down, Home and End", () => {
        const { slider, onChange } = setup("medium");
        fireEvent.keyDown(slider, { key: "ArrowRight" });
        expect(onChange).toHaveBeenLastCalledWith("high", "key");
        fireEvent.keyDown(slider, { key: "ArrowUp" });
        expect(onChange).toHaveBeenLastCalledWith("high", "key");
        fireEvent.keyDown(slider, { key: "ArrowLeft" });
        expect(onChange).toHaveBeenLastCalledWith("low", "key");
        fireEvent.keyDown(slider, { key: "ArrowDown" });
        expect(onChange).toHaveBeenLastCalledWith("low", "key");
        fireEvent.keyDown(slider, { key: "PageUp" });
        expect(onChange).toHaveBeenLastCalledWith("high", "key");
        fireEvent.keyDown(slider, { key: "PageDown" });
        expect(onChange).toHaveBeenLastCalledWith("low", "key");
        fireEvent.keyDown(slider, { key: "Home" });
        expect(onChange).toHaveBeenLastCalledWith("none", "key");
        fireEvent.keyDown(slider, { key: "End" });
        expect(onChange).toHaveBeenLastCalledWith("xhigh", "key");
    });

    it("ignores other keys so the menu keeps them", () => {
        const { slider, onChange } = setup("medium");
        fireEvent.keyDown(slider, { key: "a" });
        fireEvent.keyDown(slider, { key: "Tab" });
        expect(onChange).not.toHaveBeenCalled();
    });

    it("gives the keyboard no animation, and a click its 160 ms", () => {
        const { slider, rerender, container, onChange } = setup("low");
        const redraw = (level: ReasoningLevel) =>
            rerender(
                <ReasoningLadderUI
                    levels={WITH_NONE}
                    level={level}
                    onChange={onChange}
                    label="Reasoning level"
                    valueText={level}
                />,
            );
        fireEvent.keyDown(slider, { key: "End" });
        redraw("xhigh");
        expect(stepVars(container, ".litt-ladder-step", "--ladder-dur")).toEqual([
            "0ms",
            "0ms",
            "0ms",
            "0ms",
        ]);
        fireEvent.pointerDown(slider, { clientX: 5, pointerType: "mouse" });
        redraw("low");
        expect(stepVars(container, ".litt-ladder-step", "--ladder-dur")).toEqual([
            "0ms",
            "110ms",
            "110ms",
            "110ms",
        ]);
        expect(stepVars(container, ".litt-ladder-step", "--ladder-delay")).toEqual([
            "0ms",
            "40ms",
            "20ms",
            "0ms",
        ]);
    });

    it("gives a drag no animation", () => {
        const { slider, onChange, rerender, container } = setup("low");
        fireEvent.pointerDown(slider, { clientX: 5, pointerType: "mouse" });
        fireEvent.pointerMove(slider, { clientX: 90, pointerType: "mouse" });
        expect(onChange).toHaveBeenLastCalledWith("xhigh", "drag");
        rerender(
            <ReasoningLadderUI
                levels={WITH_NONE}
                level="xhigh"
                onChange={onChange}
                label="Reasoning level"
                valueText="xhigh"
            />,
        );
        expect(
            stepVars(container, ".litt-ladder-step", "--ladder-dur").every((v) => v === "0ms"),
        ).toBe(true);
    });

    it("gives reduced motion no animation, even for a click", () => {
        mockReducedMotion(true);
        const { slider, onChange, rerender, container } = setup("none");
        fireEvent.pointerDown(slider, { clientX: 95, pointerType: "mouse" });
        expect(onChange).toHaveBeenLastCalledWith("xhigh", "pointer");
        rerender(
            <ReasoningLadderUI
                levels={WITH_NONE}
                level="xhigh"
                onChange={onChange}
                label="Reasoning level"
                valueText="xhigh"
            />,
        );
        expect(
            stepVars(container, ".litt-ladder-step", "--ladder-dur").every((v) => v === "0ms"),
        ).toBe(true);
    });

    it("rises 160 ms per step on a click, and ends on the right level if interrupted", () => {
        const { slider, onChange, rerender, container } = setup("none");
        const redraw = (level: ReasoningLevel) =>
            rerender(
                <ReasoningLadderUI
                    levels={WITH_NONE}
                    level={level}
                    onChange={onChange}
                    label="Reasoning level"
                    valueText={level}
                />,
            );
        fireEvent.pointerDown(slider, { clientX: 95, pointerType: "mouse" });
        expect(onChange).toHaveBeenLastCalledWith("xhigh", "pointer");
        redraw("xhigh");
        expect(stepVars(container, ".litt-ladder-step", "--ladder-dur")).toEqual([
            "160ms",
            "160ms",
            "160ms",
            "160ms",
        ]);
        expect(stepVars(container, ".litt-ladder-step", "--ladder-delay")).toEqual([
            "0ms",
            "30ms",
            "60ms",
            "90ms",
        ]);
        // Interrupted halfway: down to one step. The final state is exact.
        redraw("low");
        const on = [...container.querySelectorAll(".litt-ladder-step")].map((s) =>
            s.getAttribute("data-on"),
        );
        expect(on).toEqual(["true", "false", "false", "false"]);
        expect(slider).toHaveAttribute("aria-valuenow", "1");
    });

    it("turns reasoning off when the first step is chosen again", () => {
        const { slider, onChange } = setup("low");
        fireEvent.pointerDown(slider, { clientX: 5, pointerType: "mouse" });
        expect(onChange).toHaveBeenLastCalledWith("none", "pointer");
    });

    it("marks the steps up to the mouse and reports the level it would choose", () => {
        const { slider, onPreview, container } = setup("low");
        fireEvent.pointerMove(slider, { clientX: 60, pointerType: "mouse" });
        expect(onPreview).toHaveBeenLastCalledWith("high");
        const marked = [...container.querySelectorAll(".litt-ladder-step")].map((s) =>
            s.getAttribute("data-preview"),
        );
        expect(marked).toEqual(["true", "true", "true", "false"]);
        fireEvent.pointerLeave(slider);
        expect(onPreview).toHaveBeenLastCalledWith(null);
        // A finger previews nothing.
        onPreview.mockClear();
        fireEvent.pointerMove(slider, { clientX: 60, pointerType: "touch" });
        expect(onPreview).not.toHaveBeenCalled();
    });
});

describe("ReasoningMiniUI", () => {
    it("is hidden from assistive technology and has the model's steps", () => {
        const { container } = render(<ReasoningMiniUI levels={FOUR} level="high" />);
        const mini = container.querySelector("[data-litt-ladder-mini]");
        expect(mini).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelectorAll(".litt-ladder-mini-step")).toHaveLength(4);
        expect(
            [...container.querySelectorAll(".litt-ladder-mini-step")].map((s) =>
                s.getAttribute("data-on"),
            ),
        ).toEqual(["true", "true", "true", "false"]);
        expect(stepVars(container, ".litt-ladder-mini-step", "--ladder-h")).toEqual([
            "4px",
            "6px",
            "8px",
            "10px",
        ]);
    });

    it("leaves every step empty at none", () => {
        const { container } = render(<ReasoningMiniUI levels={WITH_NONE} level="none" />);
        expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(0);
    });

    it("animates a change, but not while LiTT works", () => {
        const { container, rerender } = render(
            <ReasoningMiniUI levels={FOUR} level="low" />,
        );
        rerender(<ReasoningMiniUI levels={FOUR} level="xhigh" />);
        expect(stepVars(container, ".litt-ladder-mini-step", "--ladder-dur")).toEqual([
            "0ms",
            "140ms",
            "140ms",
            "140ms",
        ]);
        rerender(<ReasoningMiniUI levels={FOUR} level="low" instant />);
        expect(
            stepVars(container, ".litt-ladder-mini-step", "--ladder-dur").every((v) => v === "0ms"),
        ).toBe(true);
        expect(container.querySelectorAll('[data-on="true"]')).toHaveLength(1);
    });
});

describe("the model button", () => {
    const models = [
        { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", group: "Anthropic" },
    ] as const;

    function toggle(extra: Partial<React.ComponentProps<typeof ModelToggleUI>> = {}) {
        return (
            <ModelToggleUI
                value="claude-sonnet-5-5"
                onChange={vi.fn()}
                models={models}
                compact
                compactShowsName
                reasoningLevel="high"
                reasoningLevels={FOUR}
                onReasoningChange={vi.fn()}
                {...extra}
            />
        );
    }

    it("says the model and the level in its accessible name", () => {
        render(toggle());
        expect(
            screen.getByRole("button", {
                name: "Choose model: Claude Sonnet 5.5, reasoning High",
            }),
        ).toBeInTheDocument();
    });

    it("draws the level's thumbnail beside the name, with no chevron", () => {
        const { container } = render(toggle());
        const button = screen.getByRole("button", { name: /^Choose model/ });
        expect(button.querySelector("[data-litt-ladder-mini]")).toBeInTheDocument();
        expect(container.querySelectorAll(".litt-ladder-mini-step")).toHaveLength(4);
        expect(button.querySelector("svg")).not.toBeInTheDocument();
    });

    it("keeps the controls icon where there is no room for the name", () => {
        render(toggle({ compactShowsName: false }));
        const button = screen.getByRole("button", { name: /^Choose model/ });
        expect(button.querySelector("[data-litt-ladder-mini]")).not.toBeInTheDocument();
        expect(button.querySelector("svg")).toBeInTheDocument();
    });

    it("opens a menu with a ladder, rows without dots and a check on the chosen one", async () => {
        const { default: userEvent } = await import("@testing-library/user-event");
        const user = userEvent.setup();
        render(toggle());
        await user.click(screen.getByRole("button", { name: /^Choose model/ }));
        const slider = await screen.findByRole("slider", { name: "Reasoning level" });
        expect(slider).toHaveAttribute("aria-valuenow", "3");
        expect(slider).toHaveAttribute("aria-valuetext", "High");
        const row = screen.getByRole("menuitem", { name: /Claude Sonnet 5.5/ });
        expect(row).toHaveAttribute("data-selected", "true");
        expect(row.querySelector("svg")).toBeInTheDocument();
        expect(row.querySelector(".rounded-full")).not.toBeInTheDocument();
        expect(row).toHaveClass("min-h-8", "pointer-coarse:min-h-11");
    });

    it("keeps the menu's ladder still when it opens: the level does not sweep", async () => {
        const { default: userEvent } = await import("@testing-library/user-event");
        const user = userEvent.setup();
        render(toggle());
        await user.click(screen.getByRole("button", { name: /^Choose model/ }));
        const slider = await screen.findByRole("slider", { name: "Reasoning level" });
        const durations = [...slider.querySelectorAll<HTMLElement>(".litt-ladder-step")].map((s) =>
            s.style.getPropertyValue("--ladder-dur"),
        );
        expect(durations).toEqual(["0ms", "0ms", "0ms", "0ms"]);
    });

    it("moves the level with the ladder's keys and does not animate the thumbnail", async () => {
        const { default: userEvent } = await import("@testing-library/user-event");
        const user = userEvent.setup();
        const onReasoningChange = vi.fn();
        render(toggle({ onReasoningChange }));
        await user.click(screen.getByRole("button", { name: /^Choose model/ }));
        const slider = await screen.findByRole("slider", { name: "Reasoning level" });
        act(() => slider.focus());
        await user.keyboard("{End}");
        expect(onReasoningChange).toHaveBeenLastCalledWith("xhigh");
    });
});

describe("amber", () => {
    const here = (file: string): string =>
        readFileSync(resolve(process.cwd(), "..", "packages/ui/src", file), "utf8");

    it("is not in the classes of the composer, its labels, its picker or its thumbnail", () => {
        for (const file of [
            "ComposerSurfaceUI.styles.ts",
            "ModelToggleUI.tsx",
            "ReasoningLadderUI.tsx",
        ]) {
            const source = here(file);
            expect(source, file).not.toMatch(
                /(?:bg|text|border|ring|outline|fill|stroke|from|to|via|shadow)-(?:amber|yellow|orange|\[#(?:ffb21e|965900))|#ffb21e|#965900/i,
            );
        }
    });

    it("is, in the stylesheet, only in the menu's filled steps (and the focus outline)", () => {
        const css = readFileSync(
            resolve(process.cwd(), "..", "packages/ui/styles/DesignTokensUI.css"),
            "utf8",
        );
        const users: string[] = [];
        postcss.parse(css).walkRules((rule) => {
            if (!/litt-(ladder|composer|model)/.test(rule.selector)) return;
            rule.walkDecls((decl) => {
                if (/--litt-ladder-amber(?!-)|ambar|--litt-accent|--focus-ring/.test(decl.value)) {
                    users.push(rule.selector);
                }
            });
        });
        expect(users).toEqual([".litt-ladder-step > i"]);
    });
});
