import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ChatInput } from "./ChatInput";
import { isModelAvailable } from "@/app/lib/modelAvailability";

const getChatCredentialOptions = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/mikeApi", () => ({
    getChatCredentialOptions,
    listWorkflows: vi.fn(async () => []),
    uploadProjectDocument: vi.fn(),
    uploadStandaloneDocument: vi.fn(),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: vi.fn(),
}));
vi.mock("@/app/hooks/useConfiguredModels", () => ({
    useConfiguredModels: () => [],
}));

vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));

// The real module is kept for its constants — useSelectedModel imports
// ALLOWED_MODEL_IDS/DEFAULT_MODEL_ID/canonicalModelId from it, and this test
// exercises the real hook.
vi.mock("./ModelToggle", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./ModelToggle")>()),
    ModelToggle: ({
        onChange,
        choiceRequest,
        onChoiceHandled,
        previousModelId,
    }: {
        previousModelId?: string | null;
        onChange: (model: string) => void;
        choiceRequest?: object | null;
        onChoiceHandled?: () => void;
    }) => (
        <>
            <button type="button" onClick={() => onChange("gpt-6-astra")}>
                Select test model
            </button>
            <span data-testid="previous-model">{previousModelId ?? "none"}</span>
            {choiceRequest && (
                <div role="status" data-testid="selector-open">
                    <button type="button" onClick={onChoiceHandled}>
                        Close selector
                    </button>
                </div>
            )}
        </>
    ),
}));

vi.mock("./AddDocButton", () => ({ AddDocButton: () => null }));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({
    AddDocumentsModal: () => null,
}));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: () => null,
}));
vi.mock("../popups/ApiKeyMissingPopup", () => ({
    ApiKeyMissingPopup: () => null,
}));

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

function mockProfile(lastSelectedChatModel: string | null = null) {
    vi.mocked(useUserProfile).mockReturnValue({
        profile: {
            openRouterModels: [],
            vercelModels: [],
            openCodeGoModels: [],
            lastSelectedChatModel,
            lastSelectedReasoningLevel: "high",
            apiKeys: {},
        },
        loading: false,
        apiKeysDegraded: false,
        persistChatModelSelection: vi.fn(async () => true),
        persistChatReasoningSelection: vi.fn(async () => true),
    } as unknown as ReturnType<typeof useUserProfile>);
}

describe("ChatInput sending with no model chosen", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        getChatCredentialOptions.mockResolvedValue({ provider: "openai", options: [], default: null });
        mockProfile();
    });

    it("looks off but answers: aria-disabled, selector opens, the text stays, nothing is sent", async () => {
        const onSubmit = vi.fn();
        render(<ChatInput onSubmit={onSubmit} onCancel={vi.fn()} isLoading={false} />);
        const box = screen.getByRole("combobox");
        fireEvent.change(box, { target: { value: "hola" } });
        const send = screen.getByRole("button", { name: "Send message" });
        expect(send).toHaveAttribute("aria-disabled", "true");
        expect(send).not.toBeDisabled();

        fireEvent.click(send);
        expect(await screen.findByTestId("selector-open")).toBeInTheDocument();
        expect(box).toHaveValue("hola");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(screen.queryByText("Select a model")).toBeNull();
    });

    it("Enter does the same", async () => {
        const onSubmit = vi.fn();
        render(<ChatInput onSubmit={onSubmit} onCancel={vi.fn()} isLoading={false} />);
        const box = screen.getByRole("combobox");
        fireEvent.change(box, { target: { value: "hola" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(await screen.findByTestId("selector-open")).toBeInTheDocument();
        expect(box).toHaveValue("hola");
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("choosing a model enables the send and sends the kept text", async () => {
        const onSubmit = vi.fn();
        render(<ChatInput onSubmit={onSubmit} onCancel={vi.fn()} isLoading={false} />);
        fireEvent.change(screen.getByRole("combobox"), { target: { value: "hola" } });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        fireEvent.click(await screen.findByRole("button", { name: "Select test model" }));
        fireEvent.click(screen.getByRole("button", { name: "Close selector" }));
        const send = screen.getByRole("button", { name: "Send message" });
        expect(send).not.toHaveAttribute("aria-disabled");
        fireEvent.click(send);
        await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ content: "hola", model: "gpt-6-astra" })));
    });

    it("hands the picker the saved model it can no longer use", () => {
        vi.mocked(isModelAvailable).mockReturnValue(false);
        mockProfile("gemini-3.8-flash");
        render(<ChatInput onSubmit={vi.fn()} onCancel={vi.fn()} isLoading={false} />);
        expect(screen.getByTestId("previous-model")).toHaveTextContent("gemini-3.8-flash");
    });

    it("hands the picker nothing when the saved model still works or none was saved", () => {
        vi.mocked(isModelAvailable).mockReturnValue(true);
        mockProfile("gemini-3.8-flash");
        const { unmount } = render(<ChatInput onSubmit={vi.fn()} onCancel={vi.fn()} isLoading={false} />);
        expect(screen.getByTestId("previous-model")).toHaveTextContent("none");
        unmount();
        mockProfile(null);
        render(<ChatInput onSubmit={vi.fn()} onCancel={vi.fn()} isLoading={false} />);
        expect(screen.getByTestId("previous-model")).toHaveTextContent("none");
    });

    it("keeps the empty box fully disabled", () => {
        render(<ChatInput onSubmit={vi.fn()} onCancel={vi.fn()} isLoading={false} />);
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    });
});
