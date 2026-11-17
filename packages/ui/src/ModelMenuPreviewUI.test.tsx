import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeyChipUI } from "./KeyChipUI";
import {
    ModelChipPreviewUI,
    ModelMenuPreviewUI,
    reasoningLevelsForModel,
    type ModelToggleOption,
} from "./ModelToggleUI";

const models: ModelToggleOption[] = [
    { id: "a1", label: "Claude One", group: "Anthropic" },
    { id: "a2", label: "Claude Two", group: "Anthropic" },
    { id: "r1", label: "Router One", group: "OpenRouter" },
    { id: "r2", label: "Router Two", group: "OpenRouter" },
];
const levels = reasoningLevelsForModel("r2");

describe("ModelMenuPreviewUI", () => {
    it("draws the open menu as a still picture: no menu role, no handlers, inert", () => {
        const { container } = render(
            <ModelMenuPreviewUI
                models={models}
                value="r2"
                expandedGroup="OpenRouter"
                reasoningLevel="high"
                reasoningLevels={levels}
            />,
        );
        const menu = container.firstElementChild!;
        expect(menu).toHaveAttribute("inert");
        expect(menu).toHaveClass("litt-composer-menu", "theme-dropdown-surface");
        expect(menu.querySelector('[role^="menu"]')).toBeNull();
        const groups = menu.querySelectorAll("[aria-expanded]");
        expect([...groups].map((g) => g.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
        expect(menu.querySelectorAll(".litt-model-row")).toHaveLength(2);
        expect(menu.querySelector('.litt-model-row[data-selected="true"]')).toHaveTextContent("Router Two");
        expect(menu.querySelectorAll('.litt-ladder-step[data-on="true"]')).toHaveLength(3);
        expect(menu.querySelectorAll(".litt-ladder-step")).toHaveLength(4);
        expect(menu.querySelector("[data-slot=dropdown-separator]")).not.toBeNull();
    });

    it("takes a class for its host's placement", () => {
        const { container } = render(
            <ModelMenuPreviewUI
                models={models}
                value="a1"
                expandedGroup="Anthropic"
                className="ml-auto"
                onReasoningChange={() => {}}
                reasoningLevel="low"
                reasoningLevels={levels}
            />,
        );
        expect(container.firstElementChild).toHaveClass("ml-auto", "z-auto");
    });
});

describe("ModelChipPreviewUI and KeyChipUI preview", () => {
    it("draw the composer's buttons as plain spans", () => {
        const { container } = render(
            <>
                <ModelChipPreviewUI label="Router Two" reasoningLevel="high" reasoningLevels={levels} />
                <KeyChipUI preview label="Firm key" />
            </>,
        );
        expect(container.querySelector("button")).toBeNull();
        expect(container.textContent).toContain("Router Two");
        expect(container.textContent).toContain("Firm key");
        expect(container.querySelector("[data-litt-ladder-mini]")).not.toBeNull();
    });
});

describe("KeyChipUI", () => {
    it("is a button that can be the trigger of a menu; compact keeps only the key", () => {
        const { container, rerender } = render(<KeyChipUI label="Firm key" aria-label="Key: Firm key" />);
        const button = container.querySelector("button")!;
        expect(button).toHaveAttribute("type", "button");
        expect(button).toHaveAttribute("aria-label", "Key: Firm key");
        expect(button).toHaveTextContent("Firm key");
        rerender(<KeyChipUI compact label="Firm key" aria-label="Key: Firm key" />);
        expect(container.querySelector("button")).not.toHaveTextContent("Firm key");
    });
});
