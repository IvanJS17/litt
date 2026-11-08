import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { requestTrainingReply } from "@mike/ui";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useTrainingStage } from "@/app/hooks/useTrainingStage";
import { ChatInput } from "./ChatInput";

const NO_MODES = vi.hoisted(() => ({
    modes: [] as import("@mike/contracts").TrainingTurnMode[],
    nextHintLevel: null as 1 | 2 | 3 | null,
    counterpartNextStep: null as 1 | 2 | 3 | null,
}));

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(async () => []),
    getChatCredentialOptions: vi.fn(async () => ({ provider: "openai", options: [], default: null })),
    uploadProjectDocument: vi.fn(),
    uploadStandaloneDocument: vi.fn(),
}));
vi.mock("@/app/hooks/useTrainingStage", () => ({
    useTrainingStage: vi.fn(() => ({
        attemptRequired: false,
        confidenceRequired: false,
        urgencyPassExpiresAt: null,
        ...NO_MODES,
    })),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({ useUserProfile: vi.fn() }));
vi.mock("@/app/hooks/useConfiguredModels", () => ({ useConfiguredModels: () => [] }));
vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));
vi.mock("./ModelToggle", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./ModelToggle")>()),
    ModelToggle: () => null,
}));
vi.mock("./AddDocButton", () => ({ AddDocButton: () => null }));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({ AddDocumentsModal: () => null }));
vi.mock("./AssistantWorkflowModal", () => ({ AssistantWorkflowModal: () => null }));
vi.mock("../popups/ApiKeyMissingPopup", () => ({ ApiKeyMissingPopup: () => null }));

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

const ATTEMPT = "Creo que procede la rescisión por incumplimiento de la cláusula quinta.";

function renderComposer(onSubmit = vi.fn()) {
    render(
        <ChatInput
            trainingTurns
            projectId="p1"
            chatKey="chat-1"
            chatId="chat-1"
            chatModel="gpt-6-luna"
            onSubmit={onSubmit}
            onCancel={vi.fn()}
            isLoading={false}
        />,
    );
    return onSubmit;
}

function send(text: string) {
    const box = screen.getByPlaceholderText("How can I help?");
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
}

describe("ChatInput — «Tu turno primero»", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        vi.mocked(useUserProfile).mockReturnValue({
            profile: {
                openRouterModels: [],
                vercelModels: [],
                openCodeGoModels: [],
                lastSelectedChatModel: "gpt-6-luna",
                apiKeys: {},
            },
            loading: false,
            apiKeysDegraded: false,
            persistChatModelSelection: vi.fn(async () => true),
            persistChatReasoningSelection: vi.fn(async () => true),
        } as unknown as ReturnType<typeof useUserProfile>);
    });

    const owed = { attemptRequired: true, confidenceRequired: true, urgencyPassExpiresAt: null, ...NO_MODES };

    it("asks a pasante for their approach and their mark, and holds the send until both are there", () => {
        vi.mocked(useTrainingStage).mockReturnValue(owed);
        const onSubmit = renderComposer();
        expect(vi.mocked(useTrainingStage)).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: "p1", enabled: true }),
        );
        const field = screen.getByLabelText("Your approach (2–3 lines)");
        expect(field).toBeRequired();
        const group = screen.getByRole("radiogroup", { name: "How sure are you of your approach?" });
        expect(within(group).getAllByRole("radio")).toHaveLength(4);

        fireEvent.change(field, { target: { value: "Muy corto" } });
        send("¿Procede la rescisión?");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByText(/51 characters to go/)).toBeInTheDocument();

        // A long enough approach is still not a send without the mark.
        fireEvent.change(field, { target: { value: `  ${ATTEMPT}  ` } });
        send("¿Procede la rescisión?");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent("Mark how sure you are before sending.");
        expect(group).toHaveAttribute("aria-invalid", "true");

        fireEvent.click(screen.getByRole("radio", { name: "Fairly sure" }));
        expect(screen.queryByRole("alert")).toBeNull();
        send("¿Procede la rescisión?");
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                content: "¿Procede la rescisión?",
                attempt: ATTEMPT,
                confidence: 3,
            }),
        );
        // One mark per approach: the next approach starts without one.
        expect(screen.getByRole("radio", { name: "Fairly sure" })).not.toBeChecked();
        expect(field).toHaveValue("");
    });

    it("asks for the approach alone from a server that does not ask for a mark", () => {
        vi.mocked(useTrainingStage).mockReturnValue({ ...owed, confidenceRequired: false });
        const onSubmit = renderComposer();
        expect(screen.queryByRole("radiogroup")).toBeNull();
        fireEvent.change(screen.getByLabelText("Your approach (2–3 lines)"), { target: { value: ATTEMPT } });
        send("¿Procede la rescisión?");
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toHaveProperty("attempt", ATTEMPT);
        expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("confidence");
    });

    it("takes a basis question to the approach field when the note's «Responder» is pressed", async () => {
        vi.mocked(useTrainingStage).mockReturnValue(owed);
        const onSubmit = renderComposer();
        const field = screen.getByLabelText("Your approach (2–3 lines)");
        fireEvent.change(field, { target: { value: "Mi idea." } });
        fireEvent.change(field, { target: { value: "Short" } });
        send("x");
        expect(field).toHaveAttribute("aria-invalid", "true");
        act(() => requestTrainingReply("¿En qué precepto se apoya?"));
        expect(field).toHaveValue("> ¿En qué precepto se apoya?\n\nShort");
        expect(field).not.toHaveAttribute("aria-invalid");
        await waitFor(() => expect(document.activeElement).toBe(field));

        // The quotation is not an approach: the person still owes 60 of their own.
        fireEvent.change(field, { target: { value: `> ${"¿En qué precepto se apoya? ".repeat(4)}\n\nCorto` } });
        fireEvent.click(screen.getByRole("radio", { name: "Sure" }));
        send("x");
        expect(onSubmit).not.toHaveBeenCalled();
        fireEvent.change(field, { target: { value: `> ¿En qué precepto?\n\n${ATTEMPT}` } });
        send("x");
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ attempt: `> ¿En qué precepto?\n\n${ATTEMPT}`, confidence: 4 }),
        );
    });

    it("does not listen for «Responder» where no approach is owed", () => {
        vi.mocked(useTrainingStage).mockReturnValue({
            attemptRequired: false,
            confidenceRequired: false,
            urgencyPassExpiresAt: null,
            ...NO_MODES,
        });
        renderComposer();
        act(() => requestTrainingReply("¿Por qué?"));
        expect(screen.queryByLabelText("Your approach (2–3 lines)")).toBeNull();
    });

    it("speaks the user's language: the field, the thermometer and the pass line in es-MX", () => {
        vi.mocked(useTrainingStage).mockReturnValue(owed);
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <ChatInput
                    trainingTurns
                    projectId="p1"
                    chatKey="chat-1"
                    chatModel="gpt-6-luna"
                    onSubmit={vi.fn()}
                    onCancel={vi.fn()}
                    isLoading={false}
                />
            </IntlClientProvider>,
        );
        expect(screen.getByLabelText("Tu planteamiento (2–3 líneas)")).toBeRequired();
        const group = screen.getByRole("radiogroup", { name: "¿Qué tan seguro estás de tu planteamiento?" });
        expect(within(group).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual([
            "Casi adivino",
            "Dudo",
            "Bastante seguro",
            "Seguro",
        ]);
        expect(screen.getByText(/Faltan 60 caracteres/)).toBeInTheDocument();
    });

    it("shows a pasante with an urgency pass a line instead of the field, and sends without an attempt", () => {
        const end = new Date(Date.now() + 3_600_000);
        vi.mocked(useTrainingStage).mockReturnValue({
            attemptRequired: false,
            confidenceRequired: false,
            urgencyPassExpiresAt: end.toISOString(),
            ...NO_MODES,
        });
        const onSubmit = renderComposer();
        expect(screen.queryByLabelText("Your approach (2–3 lines)")).toBeNull();
        expect(screen.getByText(/^Urgency pass in force until /)).toBeInTheDocument();
        send("¿Procede la rescisión?");
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("attempt");
    });

    it("shows the composer of today when no attempt is required and there is no pass", () => {
        vi.mocked(useTrainingStage).mockReturnValue({
            attemptRequired: false,
            confidenceRequired: false,
            urgencyPassExpiresAt: null,
            ...NO_MODES,
        });
        const onSubmit = renderComposer();
        expect(screen.queryByLabelText("Your approach (2–3 lines)")).toBeNull();
        expect(screen.queryByText(/Urgency pass/)).toBeNull();
        send("¿Procede la rescisión?");
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("attempt");
    });

    it("does not ask for training where the composer does not start chat turns", () => {
        render(
            <ChatInput
                chatKey="chat-1"
                chatModel="gpt-6-luna"
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );
        expect(vi.mocked(useTrainingStage)).toHaveBeenCalledWith(
            expect.objectContaining({ enabled: false }),
        );
    });

    it("keeps two mounted composers apart: own ids, and «Reply» lands only in its chat's", async () => {
        vi.mocked(useTrainingStage).mockReturnValue(owed);
        render(
            <>
                {["chat-1", "chat-2"].map((chatKey) => (
                    <div key={chatKey} data-testid={chatKey}>
                        <ChatInput
                            trainingTurns
                            projectId="p1"
                            chatKey={chatKey}
                            chatId={chatKey}
                            chatModel="gpt-6-luna"
                            onSubmit={vi.fn()}
                            onCancel={vi.fn()}
                            isLoading={false}
                        />
                    </div>
                ))}
            </>,
        );
        const fields = screen.getAllByLabelText("Your approach (2–3 lines)");
        expect(fields).toHaveLength(2);
        expect(new Set(fields.map((field) => field.id)).size).toBe(2);
        // One radio group per composer: marking one must not unmark the other.
        const names = screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).name);
        expect(new Set(names).size).toBe(2);

        act(() => requestTrainingReply("¿Qué precepto?", "chat-2"));
        const first = within(screen.getByTestId("chat-1")).getByLabelText("Your approach (2–3 lines)");
        const second = within(screen.getByTestId("chat-2")).getByLabelText("Your approach (2–3 lines)");
        expect(first).toHaveValue("");
        expect(second).toHaveValue("> ¿Qué precepto?\n\n");
        await waitFor(() => expect(second).toHaveFocus());
    });

    it("takes «Responder» in a tabular chat, whose draft key is namespaced but whose note carries the raw chat id", async () => {
        vi.mocked(useTrainingStage).mockReturnValue(owed);
        render(
            <ChatInput
                trainingTurns
                projectId="p1"
                chatKey="tabular-review-chat:review-1:chat-9"
                chatId="chat-9"
                chatModel="gpt-6-luna"
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );
        const field = screen.getByLabelText("Your approach (2–3 lines)");
        act(() => requestTrainingReply("¿Qué precepto?", "chat-9"));
        expect(field).toHaveValue("> ¿Qué precepto?\n\n");
        await waitFor(() => expect(field).toHaveFocus());
        // A request for another chat is still turned away.
        act(() => requestTrainingReply("Otra", "chat-1"));
        expect(field).toHaveValue("> ¿Qué precepto?\n\n");
    });

    it("leaves a new-chat composer (no chat yet) deaf to a request aimed at a chat", () => {
        vi.mocked(useTrainingStage).mockReturnValue(owed);
        render(
            <ChatInput
                trainingTurns
                projectId="p1"
                chatModel="gpt-6-luna"
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );
        const field = screen.getByLabelText("Your approach (2–3 lines)");
        act(() => requestTrainingReply("De otro chat", "chat-2"));
        expect(field).toHaveValue("");
        act(() => requestTrainingReply("Sin chat"));
        expect(field).toHaveValue("> Sin chat\n\n");
    });

    describe("hints and the counterparty's lawyer", () => {
        const open = {
            ...owed,
            modes: ["hint", "counterpart"] as import("@mike/contracts").TrainingTurnMode[],
            nextHintLevel: 1 as 1 | 2 | 3 | null,
            counterpartNextStep: 1 as 1 | 2 | 3 | null,
        };
        const withClose = {
            ...open,
            modes: ["hint", "counterpart", "counterpart_close"] as import("@mike/contracts").TrainingTurnMode[],
            counterpartNextStep: 2 as 1 | 2 | 3 | null,
        };
        const writeApproach = () =>
            fireEvent.change(screen.getByLabelText("Your approach (2–3 lines)"), {
                target: { value: ATTEMPT },
            });

        it("asks the stage for this chat and reads it again when a turn ends", () => {
            vi.mocked(useTrainingStage).mockReturnValue(open);
            renderComposer();
            expect(vi.mocked(useTrainingStage)).toHaveBeenCalledWith(
                expect.objectContaining({ chatId: "chat-1", turnActive: false }),
            );
        });

        it("offers no help where the server opened no mode", () => {
            vi.mocked(useTrainingStage).mockReturnValue(owed);
            renderComposer();
            expect(screen.queryByRole("region", { name: "Help for this turn" })).toBeNull();
            expect(screen.queryByRole("button", { name: "Ask for a hint" })).toBeNull();
        });

        it("sends a hint unrated: the approach is required, the mark is not, and the approach stays for the next turn", () => {
            vi.mocked(useTrainingStage).mockReturnValue(open);
            const onSubmit = renderComposer();
            const hint = screen.getByRole("button", { name: "Ask for a hint" });
            const box = screen.getByPlaceholderText("How can I help?");
            fireEvent.change(box, { target: { value: "¿Procede la rescisión?" } });
            fireEvent.click(hint);
            expect(onSubmit).not.toHaveBeenCalled();
            expect(screen.getByLabelText("Your approach (2–3 lines)")).toHaveAttribute("aria-invalid", "true");

            writeApproach();
            fireEvent.click(hint);
            expect(onSubmit).toHaveBeenCalledTimes(1);
            const sent = onSubmit.mock.calls[0][0];
            expect(sent).toMatchObject({
                content: "¿Procede la rescisión?",
                attempt: ATTEMPT,
                training_mode: "hint",
            });
            expect(sent).not.toHaveProperty("confidence");
            expect(box).toHaveValue("");
            expect(screen.getByLabelText("Your approach (2–3 lines)")).toHaveValue(ATTEMPT);
        });

        it("keeps a mark already given through a hint, and sends it with the full answer", () => {
            vi.mocked(useTrainingStage).mockReturnValue(open);
            const onSubmit = renderComposer();
            writeApproach();
            fireEvent.click(screen.getByRole("radio", { name: "Sure" }));
            send("¿Procede la rescisión?");
            expect(onSubmit.mock.calls[0][0]).toMatchObject({ confidence: 4 });
            expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("training_mode");
        });

        it("holds a counterpart turn for the mark, like any turn, and sends it in its mode", () => {
            vi.mocked(useTrainingStage).mockReturnValue(open);
            const onSubmit = renderComposer();
            writeApproach();
            fireEvent.change(screen.getByPlaceholderText("How can I help?"), {
                target: { value: "Procede por el impago." },
            });
            const round = screen.getByRole("button", {
                name: "Test it against the counterparty's lawyer",
            });
            fireEvent.click(round);
            expect(onSubmit).not.toHaveBeenCalled();
            expect(screen.getByRole("alert")).toHaveTextContent("Mark how sure you are before sending.");
            fireEvent.click(screen.getByRole("radio", { name: "Fairly sure" }));
            fireEvent.click(round);
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: "Procede por el impago.",
                    attempt: ATTEMPT,
                    confidence: 3,
                    training_mode: "counterpart",
                }),
            );
            // A turn of the round is a whole turn: the approach and the mark start over.
            expect(screen.getByLabelText("Your approach (2–3 lines)")).toHaveValue("");
            expect(screen.getByRole("radio", { name: "Fairly sure" })).not.toBeChecked();
        });

        it("says a question is needed when a mode is asked for with nothing written", () => {
            vi.mocked(useTrainingStage).mockReturnValue(open);
            const onSubmit = renderComposer();
            writeApproach();
            fireEvent.click(screen.getByRole("button", { name: "Ask for a hint" }));
            expect(onSubmit).not.toHaveBeenCalled();
            expect(screen.getByRole("alert")).toHaveTextContent("Write your question first.");
            fireEvent.change(screen.getByPlaceholderText("How can I help?"), { target: { value: "x" } });
            expect(screen.queryByRole("alert")).toBeNull();
        });

        it("closes the round with its own line when nothing is written, and still owes the approach and the mark", () => {
            vi.mocked(useTrainingStage).mockReturnValue(withClose);
            const onSubmit = renderComposer();
            const close = screen.getByRole("button", { name: "Close the round" });
            fireEvent.click(close);
            expect(onSubmit).not.toHaveBeenCalled();
            writeApproach();
            fireEvent.click(screen.getByRole("radio", { name: "Sure" }));
            fireEvent.click(close);
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: "I'm closing the round with the counterparty's lawyer.",
                    attempt: ATTEMPT,
                    confidence: 4,
                    training_mode: "counterpart_close",
                }),
            );
        });

        it("keeps what the person wrote when they close the round with their own words", () => {
            vi.mocked(useTrainingStage).mockReturnValue(withClose);
            const onSubmit = renderComposer();
            writeApproach();
            fireEvent.click(screen.getByRole("radio", { name: "Sure" }));
            fireEvent.change(screen.getByPlaceholderText("How can I help?"), {
                target: { value: "Cierro, defendí la primera." },
            });
            fireEvent.click(screen.getByRole("button", { name: "Close the round" }));
            expect(onSubmit.mock.calls[0][0]).toMatchObject({ content: "Cierro, defendí la primera." });
        });

        it("does nothing while an answer is arriving", () => {
            vi.mocked(useTrainingStage).mockReturnValue(open);
            const onSubmit = vi.fn();
            render(
                <ChatInput
                    trainingTurns
                    projectId="p1"
                    chatKey="chat-1"
                    chatId="chat-1"
                    chatModel="gpt-6-luna"
                    onSubmit={onSubmit}
                    onCancel={vi.fn()}
                    isLoading
                />,
            );
            expect(screen.getByRole("button", { name: "Ask for a hint" })).toBeDisabled();
            fireEvent.click(screen.getByRole("button", { name: "Ask for a hint" }));
            expect(onSubmit).not.toHaveBeenCalled();
        });

        it("speaks es-MX, and the rung is said in words", () => {
            vi.mocked(useTrainingStage).mockReturnValue({ ...open, nextHintLevel: 2 as 1 | 2 | 3 | null });
            render(
                <IntlClientProvider locale="es-MX" messages={esMX}>
                    <ChatInput
                        trainingTurns
                        projectId="p1"
                        chatKey="chat-1"
                        chatId="chat-1"
                        chatModel="gpt-6-luna"
                        onSubmit={vi.fn()}
                        onCancel={vi.fn()}
                        isLoading={false}
                    />
                </IntlClientProvider>,
            );
            expect(screen.getByRole("button", { name: "Pedir una pista" })).toBeInTheDocument();
            expect(screen.getByText("Sigue: pista 2 de 3, Dónde buscar.")).toBeInTheDocument();
            expect(screen.getByRole("list", { name: "Escalones de la pista" })).toBeInTheDocument();
        });
    });
});
