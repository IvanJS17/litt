import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelToggleUI, shortModelLabel, type ModelToggleOption } from "./ModelToggleUI";

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
