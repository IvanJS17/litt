import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ModelToggleOption } from "@mike/client";
import { ModelGuideUI } from "./ModelGuideUI";
import { useModelGuide } from "./useModelGuide";

const models: ModelToggleOption[] = [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", group: "Anthropic" },
    { id: "claude-fable-5-2", label: "Claude Fable 5.2", group: "Anthropic" },
    { id: "custom/own-model", label: "Own Model", group: "OpenAI-compatible endpoint" },
];

function open(extra: Partial<React.ComponentProps<typeof ModelGuideUI>> = {}) {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
        <ModelGuideUI open onClose={onClose} models={models} value="claude-fable-5-2" onSelect={onSelect} {...extra} />,
    );
    return { onSelect, onClose };
}

describe("ModelGuideUI", () => {
    it("describes each model, lists the unknown ones by name and says what is in use", async () => {
        open();
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText(/data analysis and content creation/i)).toBeInTheDocument();
        expect(within(dialog).getByText("Other models in your firm")).toBeInTheDocument();
        expect(within(dialog).getByText("Own Model")).toBeInTheDocument();
        expect(within(dialog).getByText("In use")).toBeInTheDocument();
        expect(within(dialog).queryByRole("button", { name: "Use Claude Fable 5.2" })).toBeNull();
    });

    it("«Use this» selects the model and closes", async () => {
        const { onSelect, onClose } = open();
        await userEvent.click(await screen.findByRole("button", { name: "Use Claude Sonnet 5.5" }));
        expect(onSelect).toHaveBeenCalledWith("claude-sonnet-5-5");
        expect(onClose).toHaveBeenCalled();
    });

    it("has a Reasoning tab with one line per level", async () => {
        open();
        await userEvent.click(await screen.findByRole("button", { name: "Reasoning" }));
        expect(screen.getByText(/Levels depend on the model and route/)).toBeInTheDocument();
        expect(screen.getByText(/Maximum on Claude/)).toBeInTheDocument();
    });

    it("is the bottom sheet on a narrow screen, like the web's phone sheet", async () => {
        open();
        const dialog = await screen.findByRole("dialog");
        expect(dialog.className).toContain("modal-sheet");
    });

    it("renders nothing while closed", () => {
        open({ open: false });
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

describe("useModelGuide", () => {
    function Probe() {
        const guide = useModelGuide();
        const [hinted] = guide.withHints([...models]);
        const [plain] = guide.withHints([models[2]]);
        return (
            <>
                <p data-testid="hint">{hinted.hint ?? "none"}</p>
                <p data-testid="plain">{"hint" in plain ? "has" : "none"}</p>
            </>
        );
    }
    it("adds the one-line hint to catalog models only", () => {
        render(<Probe />);
        expect(screen.getByTestId("hint").textContent).not.toBe("none");
        expect(screen.getByTestId("plain").textContent).toBe("none");
    });
});
