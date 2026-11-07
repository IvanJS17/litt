import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelToggleUI, type ModelToggleOption } from "./ModelToggleUI";

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
