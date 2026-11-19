/**
 * The Word add-in's model picker: the web's «choose a model before chatting»
 * rule, the «¿Cuál elijo?» guide, «Usar este» and the per-model reasoning
 * levels. Run from the frontend test runner (the add-in has no unit runner).
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@litt/i18n";
import { reasoningLevelsForModel } from "@mike/ui";
import type { RouterSelections } from "@mike/client";

vi.mock("../../../word-addin/src/taskpane/api/mikeApi", () => ({
    getOllamaModels: vi.fn(async () => []),
}));

import { LocaleProvider } from "../../../word-addin/src/taskpane/i18n/LocaleProvider";
import { loadLocale } from "../../../word-addin/src/taskpane/i18n/loadLocale";
import { ModelToggle } from "../../../word-addin/src/taskpane/components/assistant/ModelToggle";
import { ChatInput as ComposerShell } from "../../../word-addin/src/shared/chat/ChatInput";
import type { ApiKeyStatus } from "../../../word-addin/src/taskpane/types";

const KEYS = {
    claude: true,
    gemini: false,
    openai: false,
    openrouter: false,
    vercel: false,
    "opencode-go": false,
} as ApiKeyStatus;

// No router has saved Model Selections: only the direct catalog is offered.
const NO_ROUTER_MODELS = {} as RouterSelections;

async function inPane(locale: Locale, ui: React.ReactElement) {
    const initial = await loadLocale(locale);
    return render(<LocaleProvider initial={initial}>{ui}</LocaleProvider>);
}

/** A parent that holds the model, as the pane's composer does. */
function Harness({
    initial = "",
    onChoose = () => {},
}: {
    initial?: string;
    onChoose?: (id: string) => void;
}) {
    const [model, setModel] = React.useState(initial);
    const [level, setLevel] = React.useState<"high" | "low" | "max" | "medium">("high");
    const [open, setOpen] = React.useState(false);
    return (
        <ModelToggle
            value={model}
            onChange={(id) => {
                setModel(id);
                onChoose(id);
            }}
            keyStatus={KEYS}
            routerSelections={NO_ROUTER_MODELS}
            askForChoice
            open={open}
            onOpenChange={setOpen}
            reasoningLevel={level}
            onReasoningChange={(next) => setLevel(next as typeof level)}
        />
    );
}

beforeEach(() => vi.clearAllMocks());

describe("add-in model picker asks for a choice", () => {
    it("with no model the trigger says it is needed to send (es-MX)", async () => {
        await inPane("es-MX", <Harness />);
        const trigger = screen.getByRole("button", { name: /Hace falta para enviar/ });
        expect(trigger).toHaveTextContent(/Elige un modelo/i);
    });

    it("«¿Cuál elijo?» opens the same guide and «Usar este» selects the model", async () => {
        const onChoose = vi.fn();
        await inPane("es-MX", <Harness onChoose={onChoose} />);
        await userEvent.click(screen.getByRole("button", { name: /Hace falta para enviar/ }));
        await userEvent.click(await screen.findByRole("menuitem", { name: /¿Cuál elijo\?/ }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog.className).toContain("modal-sheet");
        const use = within(dialog).getAllByRole("button", { name: /^Usar / })[0];
        await userEvent.click(use);
        expect(onChoose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).toBeNull();
        // The trigger no longer asks: a model is chosen.
        expect(screen.queryByRole("button", { name: /Hace falta para enviar/ })).toBeNull();
    });

    it("the menu lists models with their one-line hint", async () => {
        await inPane("en-US", <Harness />);
        await userEvent.click(screen.getByRole("button", { name: /Needed to send/i }));
        expect(await screen.findByRole("menuitem", { name: /Which one/i })).toBeInTheDocument();
    });
});

describe("add-in reasoning levels per model", () => {
    it("offers GLM Legal only low, high and max", () => {
        expect(reasoningLevelsForModel("opencode-go/glm-5.3-flashx-legal")).toEqual(["low", "high", "max"]);
    });

    it("shows the ladder of the chosen model in the menu", async () => {
        await inPane("en-US", <Harness initial="claude-sonnet-5-5" />);
        await userEvent.click(screen.getByRole("button", { name: /^Choose model: .+, reasoning/ }));
        expect(await screen.findByRole("slider", { name: /Reasoning level/i })).toBeInTheDocument();
        // Sonnet 5.5 reaches max on a direct route.
        expect(reasoningLevelsForModel("claude-sonnet-5-5")).toContain("max");
    });
});

describe("add-in composer cannot send without a model", () => {
    it("the arrow looks off but answers; Enter does the same; nothing is lost", () => {
        const onSubmit = vi.fn();
        render(
            <ComposerShell value="hola" onValueChange={() => {}} onSubmit={onSubmit} sendBlocked />,
        );
        const send = screen.getByTestId("chat-send");
        expect(send).toHaveAttribute("aria-disabled", "true");
        expect(send).not.toBeDisabled();
        fireEvent.click(send);
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("an empty box stays fully disabled and a ready composer has no aria-disabled", () => {
        const { rerender } = render(
            <ComposerShell value="" onValueChange={() => {}} onSubmit={vi.fn()} sendBlocked />,
        );
        expect(screen.getByTestId("chat-send")).toBeDisabled();
        rerender(<ComposerShell value="hola" onValueChange={() => {}} onSubmit={vi.fn()} />);
        expect(screen.getByTestId("chat-send")).not.toHaveAttribute("aria-disabled");
    });
});
