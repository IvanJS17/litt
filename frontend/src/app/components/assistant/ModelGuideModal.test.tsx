import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelGuideModal } from "./ModelGuideModal";

const models = [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", group: "Anthropic" },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2", group: "Anthropic" },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", group: "Anthropic" },
    { id: "custom/own-model", label: "Own Model", group: "OpenAI-compatible endpoint" },
];

function open(extra: Partial<React.ComponentProps<typeof ModelGuideModal>> = {}) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
        <ModelGuideModal open onClose={onClose} models={models} value="claude-fable-5-2" onSelect={onSelect} {...extra} />,
    );
    return { onSelect, onClose };
}

describe("ModelGuideModal", () => {
    it("lists what each model is for, the retention notice and the others by name", async () => {
        open();
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/data analysis and content creation/i)).toBeInTheDocument();
        expect(within(dialog).getAllByText(/30-day retention/).length).toBeGreaterThanOrEqual(2);
        expect(within(dialog).getByText("Other models in your firm")).toBeInTheDocument();
        expect(within(dialog).getByText("Own Model")).toBeInTheDocument();
        expect(within(dialog).getByText(/Provider-described uses/)).toBeInTheDocument();
    });

    it("«Use this» selects the model and closes", async () => {
        const { onSelect, onClose } = open();
        await userEvent.click(await screen.findByRole("button", { name: "Use Claude Sonnet 5.5" }));
        expect(onSelect).toHaveBeenCalledWith("claude-sonnet-5-5");
        expect(onClose).toHaveBeenCalled();
    });

    it("marks the model in use instead of offering it", async () => {
        open();
        await screen.findByRole("dialog");
        expect(screen.queryByRole("button", { name: "Use Claude Fable 5.2" })).toBeNull();
        expect(screen.getByText("In use")).toBeInTheDocument();
    });

    it("has a Reasoning tab with one line per level and the availability note", async () => {
        open();
        await userEvent.click(await screen.findByRole("button", { name: "Reasoning" }));
        expect(screen.getByText(/Levels depend on the model and route/)).toBeInTheDocument();
        expect(screen.getByText("Low on Claude: saves tokens, with reduced capability.")).toBeInTheDocument();
        expect(screen.getByText(/Maximum on Claude/)).toBeInTheDocument();
    });

    it("is the shared sheet on a phone", async () => {
        open();
        const dialog = await screen.findByRole("dialog");
        expect(dialog.className).toContain("modal-sheet");
        expect(dialog.querySelector('[data-slot="modal-grabber"]')).not.toBeNull();
    });
});
