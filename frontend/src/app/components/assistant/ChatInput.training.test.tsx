import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { requestTrainingReply } from "@mike/ui";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useTrainingStage } from "@/app/hooks/useTrainingStage";
import { ChatInput } from "./ChatInput";

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(async () => []),
    uploadProjectDocument: vi.fn(),
    uploadStandaloneDocument: vi.fn(),
}));
vi.mock("@/app/hooks/useTrainingStage", () => ({
    useTrainingStage: vi.fn(() => ({
        attemptRequired: false,
        confidenceRequired: false,
        urgencyPassExpiresAt: null,
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

    const owed = { attemptRequired: true, confidenceRequired: true, urgencyPassExpiresAt: null };

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
});
