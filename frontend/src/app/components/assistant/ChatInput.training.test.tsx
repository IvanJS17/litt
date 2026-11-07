import { fireEvent, render, screen } from "@testing-library/react";
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
    useTrainingStage: vi.fn(() => ({ attemptRequired: false, urgencyPassExpiresAt: null })),
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

    it("asks a pasante for their approach and holds the send until it is long enough", () => {
        vi.mocked(useTrainingStage).mockReturnValue({ attemptRequired: true, urgencyPassExpiresAt: null });
        const onSubmit = renderComposer();
        expect(vi.mocked(useTrainingStage)).toHaveBeenCalledWith(
            expect.objectContaining({ projectId: "p1", enabled: true }),
        );
        const field = screen.getByLabelText("Tu planteamiento (2–3 líneas)");
        expect(field).toBeRequired();

        fireEvent.change(field, { target: { value: "Muy corto" } });
        send("¿Procede la rescisión?");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(field).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByText(/faltan 51/)).toBeInTheDocument();

        fireEvent.change(field, { target: { value: `  ${ATTEMPT}  ` } });
        send("¿Procede la rescisión?");
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                content: "¿Procede la rescisión?",
                attempt: ATTEMPT,
            }),
        );
    });

    it("shows a pasante with an urgency pass a line instead of the field, and sends without an attempt", () => {
        const end = new Date(Date.now() + 3_600_000);
        vi.mocked(useTrainingStage).mockReturnValue({
            attemptRequired: false,
            urgencyPassExpiresAt: end.toISOString(),
        });
        const onSubmit = renderComposer();
        expect(screen.queryByLabelText("Tu planteamiento (2–3 líneas)")).toBeNull();
        expect(screen.getByText(/^Pase de urgencia vigente hasta /)).toBeInTheDocument();
        send("¿Procede la rescisión?");
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("attempt");
    });

    it("shows the composer of today when no attempt is required and there is no pass", () => {
        vi.mocked(useTrainingStage).mockReturnValue({ attemptRequired: false, urgencyPassExpiresAt: null });
        const onSubmit = renderComposer();
        expect(screen.queryByLabelText("Tu planteamiento (2–3 líneas)")).toBeNull();
        expect(screen.queryByText(/Pase de urgencia/)).toBeNull();
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
});
