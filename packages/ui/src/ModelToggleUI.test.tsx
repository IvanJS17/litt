import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
    ModelToggleUI,
    nearestReasoningLevelForModel,
    reasoningLevelsForModel,
    shortModelLabel,
    type ModelToggleOption,
} from "./ModelToggleUI";

const models: ModelToggleOption[] = [
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", group: "Anthropic" },
];

describe("ModelToggleUI as a form field", () => {
    it("can be a grey flat field, like a flat select", () => {
        render(
            <ModelToggleUI
                value="claude-opus-5-5"
                onChange={vi.fn()}
                models={models}
                selectedLabel="Claude Opus 5.5"
                selectedAvailable
                modalInput="flat"
            />,
        );
        const trigger = screen.getByRole("button", { name: "Choose model" });
        expect(trigger).toHaveTextContent("Claude Opus 5.5");
        expect(trigger).toHaveClass("w-full", "bg-app-surface-active", "rounded-xl");
    });

    it("keeps the glass field by default", () => {
        render(
            <ModelToggleUI
                value="claude-opus-5-5"
                onChange={vi.fn()}
                models={models}
                selectedLabel="Claude Opus 5.5"
                selectedAvailable
                modalInput
            />,
        );
        expect(screen.getByRole("button", { name: "Choose model" })).not.toHaveClass(
            "bg-app-surface-active",
        );
    });

    it("shows the empty state flat too", () => {
        render(<ModelToggleUI value="" onChange={vi.fn()} models={[]} modalInput="flat" onEmptyClick={vi.fn()} />);
        expect(screen.getByRole("button", { name: "No models available" })).toHaveClass(
            "bg-app-surface-active",
        );
    });
});

describe("ModelToggleUI empty state in a compact host", () => {
    // A host that squares the trigger for an icon (the narrow composer) must
    // not squeeze "No Models" down to "N…".
    it("keeps its words instead of the host's icon width", () => {
        render(
            <ModelToggleUI
                value=""
                onChange={vi.fn()}
                models={[]}
                compact
                triggerClassName="h-7.5 w-7.5"
                onEmptyClick={vi.fn()}
            />,
        );
        const trigger = screen.getByRole("button", { name: "No models available" });
        expect(trigger).toHaveClass("w-auto");
        expect(trigger).not.toHaveClass("w-7.5");
        expect(trigger).toHaveTextContent("No Models");
    });
});

describe("ModelToggleUI opened by its host", () => {
    it("opens on the selected model's group and reports the trigger closing it", async () => {
        const onOpenChange = vi.fn();
        const { rerender } = render(
            <ModelToggleUI
                value=""
                onChange={vi.fn()}
                models={models}
                open={false}
                onOpenChange={onOpenChange}
            />,
        );
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();

        rerender(
            <ModelToggleUI
                value=""
                onChange={vi.fn()}
                models={models}
                open
                onOpenChange={onOpenChange}
            />,
        );
        expect(await screen.findByRole("menu")).toBeInTheDocument();
        // The only group starts expanded, as when the trigger opens it.
        expect(
            screen.getByRole("menuitem", { name: /Claude Opus 5.5/ }),
        ).toBeInTheDocument();

        await userEvent.keyboard("{Escape}");
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });
});

describe("shortModelLabel", () => {
    it("drops the maker's prefix and a Preview note, never the version", () => {
        expect(shortModelLabel("Claude Fable 5.2")).toBe("Fable 5.2");
        expect(shortModelLabel("Mistral Large 4 (Preview)")).toBe("Mistral Large 4");
        expect(shortModelLabel("GPT-6.1 Sol")).toBe("GPT-6.1 Sol");
        expect(shortModelLabel("Claude Fable 5.2 (vista previa) ")).toBe("Fable 5.2");
        expect(shortModelLabel("Claudette 2")).toBe("Claudette 2");
        expect(shortModelLabel("Claude (Preview)")).toBe("Claude (Preview)");
    });

    it("stays linear on a label of many tabs", () => {
        const label = `x${"\t".repeat(50_000)}y`;
        const started = performance.now();
        expect(shortModelLabel(label)).toBe(label);
        expect(shortModelLabel("\t".repeat(50_000))).toBe("\t".repeat(50_000));
        expect(performance.now() - started).toBeLessThan(250);
    });
});

const choices: ModelToggleOption[] = [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", group: "Anthropic", hint: "Fast and balanced" },
    { id: "gpt-6-luna", label: "GPT-6 Luna", group: "OpenAI" },
];

describe("ModelToggleUI asking for a model", () => {
    it("shows a needs-choice trigger with its own name, outline and icon", () => {
        render(<ModelToggleUI value="" onChange={vi.fn()} models={choices} needsChoice compactShowsName compact />);
        // Label in Name (WCAG 2.5.3): the name starts with the visible text.
        const trigger = screen.getByRole("button", { name: "Choose model. Needed to send." });
        expect(trigger).toHaveTextContent("Choose model");
        expect(trigger).toHaveClass("ring-1", "ring-interactive-border", "font-medium");
        expect(trigger.querySelector("svg")).not.toBeNull();
    });

    it("is the normal trigger once a model is chosen, while loading, and as a form field", () => {
        const { rerender } = render(
            <ModelToggleUI value="gpt-6-luna" onChange={vi.fn()} models={choices} needsChoice selectedLabel="GPT-6 Luna" />,
        );
        expect(screen.getByRole("button", { name: "Choose model" })).not.toHaveClass("ring-interactive-border");
        rerender(<ModelToggleUI value="" onChange={vi.fn()} models={choices} needsChoice loading />);
        expect(screen.queryByRole("button", { name: /Needed to send/ })).toBeNull();
        rerender(<ModelToggleUI value="" onChange={vi.fn()} models={choices} needsChoice modalInput="flat" />);
        expect(screen.queryByRole("button", { name: /Needed to send/ })).toBeNull();
    });

    it("opened to choose: says why, focuses the first model and keeps hints under names", async () => {
        const props = { value: "", onChange: vi.fn(), models: choices, needsChoice: true, onOpenChange: vi.fn() };
        const { rerender } = render(<ModelToggleUI {...props} open={false} />);
        rerender(<ModelToggleUI {...props} open openReason="send" />);
        expect(await screen.findByRole("status")).toHaveTextContent(
            "To send your message, choose a model. What you typed is kept.",
        );
        const first = await screen.findByRole("menuitem", { name: /Claude Sonnet 5.5/ });
        await waitFor(() => expect(first).toHaveFocus());
        expect(first).toHaveTextContent("Fast and balanced");
    });

    it("names the previous model that is gone, and the send reason wins over it", async () => {
        const props = { value: "", onChange: vi.fn(), models: choices, needsChoice: true, onOpenChange: vi.fn() };
        const gone = "GLM-Legal ya no está disponible en tu despacho. Elige otro.";
        const { rerender } = render(<ModelToggleUI {...props} open previousGone={gone} />);
        expect(await screen.findByRole("status")).toHaveTextContent(gone);
        rerender(<ModelToggleUI {...props} open openReason="send" previousGone={gone} />);
        expect(await screen.findByRole("status")).toHaveTextContent("To send your message");
        expect(screen.queryByText(gone)).toBeNull();
    });

    it("has no status line when the person opened it themselves", async () => {
        render(<ModelToggleUI value="" onChange={vi.fn()} models={choices} needsChoice open onOpenChange={vi.fn()} />);
        await screen.findByRole("menu");
        expect(screen.queryByRole("status")).toBeNull();
    });

    it("offers the guide as the last row only when the host handles it", async () => {
        const onOpenGuide = vi.fn();
        const { rerender } = render(
            <ModelToggleUI value="" onChange={vi.fn()} models={choices} open onOpenChange={vi.fn()} />,
        );
        await screen.findByRole("menu");
        expect(screen.queryByRole("menuitem", { name: /Which one should I pick/ })).toBeNull();
        rerender(
            <ModelToggleUI value="" onChange={vi.fn()} models={choices} open onOpenChange={vi.fn()} onOpenGuide={onOpenGuide} />,
        );
        await userEvent.click(await screen.findByRole("menuitem", { name: /Which one should I pick/ }));
        expect(onOpenGuide).toHaveBeenCalledTimes(1);
    });

    it("writes the hint of the level under the ladder", async () => {
        render(
            <ModelToggleUI
                value="claude-sonnet-5-5"
                onChange={vi.fn()}
                models={choices}
                open
                onOpenChange={vi.fn()}
                reasoningLevel="medium"
                onReasoningChange={vi.fn()}
                reasoningLevels={["low", "medium", "high"]}
                levelHints={{ low: "L", medium: "A balance", high: "H" }}
            />,
        );
        expect(await screen.findByText("A balance")).toBeInTheDocument();
    });
});

describe("reasoningLevelsForModel", () => {
    it("gives GLM 5.3 FlashX Legal only low, high and max (Z.ai), never none", () => {
        const levels = reasoningLevelsForModel("openrouter/z-ai/glm-5.3-flashx-legal");
        expect(levels).toEqual(["low", "high", "max"]);
        expect(reasoningLevelsForModel("z-ai/glm-5.3-flashx-legal")).not.toContain("none");
        // Another GLM keeps the standard ladder.
        expect(reasoningLevelsForModel("openrouter/z-ai/glm-5.3")).toContain("none");
    });

    it("lets Mistral Large 4 choose low, medium or high, never none", () => {
        expect(reasoningLevelsForModel("mistral-large-4")).toEqual(["low", "medium", "high"]);
        expect(reasoningLevelsForModel("openrouter/mistral-large-4")).toEqual(["low", "medium", "high"]);
    });

    it("keeps none and high for the other Mistral models", () => {
        expect(reasoningLevelsForModel("mistral-medium-3-5")).toEqual(["none", "high"]);
        expect(reasoningLevelsForModel("mistral-small-2603")).toEqual(["none", "high"]);
    });

    it("adds max for the direct Claude models the provider mapping sends it for", () => {
        expect(reasoningLevelsForModel("claude-fable-5-2")).toEqual(["low", "medium", "high", "xhigh", "max"]);
        expect(reasoningLevelsForModel("claude-opus-5-5")).toEqual(["low", "medium", "high", "xhigh", "max"]);
        expect(reasoningLevelsForModel("claude-sonnet-5-5")).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    });

    it("never offers none to Fable 5.2 and keeps Fable 5.1 and routed Claude as before", () => {
        expect(reasoningLevelsForModel("claude-fable-5-2")).not.toContain("none");
        expect(reasoningLevelsForModel("claude-fable-5-1")).toEqual(["low", "medium", "high", "xhigh"]);
        expect(reasoningLevelsForModel("openrouter/claude-opus-5-5")).toEqual(["low", "medium", "high", "xhigh"]);
        expect(reasoningLevelsForModel("vertex/claude-opus-5-5@20260101")).not.toContain("max");
    });

    it("moves a saved level to the nearest one the model offers", () => {
        expect(nearestReasoningLevelForModel("mistral-large-4", "none")).toBe("low");
        expect(nearestReasoningLevelForModel("mistral-large-4", "xhigh")).toBe("high");
        expect(nearestReasoningLevelForModel("claude-fable-5-1", "max")).toBe("xhigh");
        expect(nearestReasoningLevelForModel("claude-fable-5-2", "none")).toBe("low");
        expect(nearestReasoningLevelForModel("claude-opus-5-5", "max")).toBe("max");
    });
});
