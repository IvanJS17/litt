import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ChatInput } from "./ChatInput";

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
        onReasoningChange,
    }: {
        onChange: (model: string) => void;
        onReasoningChange?: (reasoning: "xhigh") => void;
    }) => (
        <>
            <button type="button" onClick={() => onChange("gpt-6-astra")}>
                Select test model
            </button>
            <button type="button" onClick={() => onReasoningChange?.("xhigh")}>
                Select test reasoning
            </button>
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

const STORED = "openrouter/pricy/frontier";
const persistChatModelSelection = vi.fn(async () => true);
const persistChatReasoningSelection = vi.fn(async () => true);

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

function emptyApiKeys() {
    return {
        claude: { configured: false, source: null },
        gemini: { configured: false, source: null },
        openai: { configured: false, source: null },
        openrouter: { configured: false, source: null },
        vercel: { configured: false, source: null },
    };
}

function mockProfile(apiKeysDegraded: boolean) {
    vi.mocked(useUserProfile).mockReturnValue({
        profile: {
            openRouterModels: [],
            vercelModels: [],
            openCodeGoModels: [],
            lastSelectedChatModel: "gpt-6-luna",
            lastSelectedReasoningLevel: "high",
            apiKeys: emptyApiKeys(),
        },
        loading: false,
        apiKeysDegraded,
        persistChatModelSelection,
        persistChatReasoningSelection,
    } as unknown as ReturnType<typeof useUserProfile>);
}

describe("ChatInput model selection vs. a degraded profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        getChatCredentialOptions.mockResolvedValue({
            provider: "openai",
            options: [],
            default: null,
        });
    });

    it("persists reasoning immediately for an existing chat", async () => {
        mockProfile(false);
        render(
            <ChatInput
                chatKey="chat-1"
                chatModel="gpt-6-luna"
                chatReasoningLevel="high"
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Select test reasoning" }),
        );

        await waitFor(() =>
            expect(persistChatReasoningSelection).toHaveBeenCalledWith(
                "xhigh",
                "chat-1",
            ),
        );
    });

    it("persists an initial-view selection to the profile immediately", async () => {
        mockProfile(false);
        render(
            <ChatInput
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Select test model" }),
        );

        await waitFor(() =>
            expect(persistChatModelSelection).toHaveBeenCalledWith(
                "gpt-6-astra",
                undefined,
            ),
        );
    });

    it("keeps an existing chat on the model it was started with (LiTT)", async () => {
        mockProfile(false);
        const onSubmit = vi.fn();
        render(
            <ChatInput
                chatKey="chat-1"
                chatModel="gpt-6-luna"
                chatReasoningLevel="high"
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Select test model" }),
        );
        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: "hello" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        expect(persistChatModelSelection).not.toHaveBeenCalled();
        const sent = onSubmit.mock.calls[0][0];
        expect(sent.model).toBe("gpt-6-luna");
        // A pinned conversation never names another key.
        expect(sent).not.toHaveProperty("credential_ref");
        expect(getChatCredentialOptions).not.toHaveBeenCalled();
        expect(
            screen.queryByRole("button", { name: /Key for this conversation/ }),
        ).toBeNull();
    });

    it("passes the tabular chat selection key through on toggle changes", async () => {
        mockProfile(false);
        const tabularChatKey = "tabular-review-chat:review-1:chat-1";
        render(
            <ChatInput
                chatKey={tabularChatKey}
                // A chat stored before routes were pinned has no model yet.
                chatModel={null}
                chatReasoningLevel="high"
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        fireEvent.click(
            screen.getByRole("button", { name: "Select test model" }),
        );

        await waitFor(() =>
            expect(persistChatModelSelection).toHaveBeenCalledWith(
                "gpt-6-astra",
                tabularChatKey,
            ),
        );
    });

    it("hides the model toggle until existing-chat settings load", () => {
        mockProfile(false);
        const { rerender } = render(
            <ChatInput
                chatKey="chat-1"
                chatModel={undefined}
                chatReasoningLevel={undefined}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        expect(
            screen.queryByRole("button", { name: "Select test model" }),
        ).not.toBeInTheDocument();

        rerender(
            <ChatInput
                chatKey="chat-1"
                chatModel="gpt-6-luna"
                chatReasoningLevel="high"
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        expect(
            screen.getByRole("button", { name: "Select test model" }),
        ).toBeInTheDocument();
    });

    it("keeps the chat model when router availability is unknown", async () => {
        mockProfile(true);
        const onSubmit = vi.fn();

        render(
            <ChatInput
                chatModel={STORED}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: "hello" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({ model: STORED }),
            ),
        );
    });

    it("falls back to profile last-selected when the chat router model is stale", async () => {
        mockProfile(false);
        const onSubmit = vi.fn();

        render(
            <ChatInput
                chatModel={STORED}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: "hello" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({ model: "gpt-6-luna" }),
            ),
        );
    });
});

describe("ChatInput key choice for a new conversation (LiTT governed BYOK)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    it("sends the server's default key, or the one the user picks", async () => {
        mockProfile(false);
        getChatCredentialOptions.mockResolvedValue({
            provider: "openai",
            options: [
                { credential_ref: "user:u1:openai:v2", source: "personal" },
                { credential_ref: "org:o1:openai:v4", source: "organization" },
            ],
            default: "user:u1:openai:v2",
        });
        const onSubmit = vi.fn();
        render(
            <ChatInput onSubmit={onSubmit} onCancel={vi.fn()} isLoading={false} />,
        );

        const trigger = await screen.findByRole("button", {
            name: "Key for this conversation: Your key",
        });
        expect(getChatCredentialOptions).toHaveBeenCalledWith(
            expect.objectContaining({ model: "gpt-6-luna" }),
        );

        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
        fireEvent.click(
            await screen.findByRole("menuitemradio", { name: "Organization key" }),
        );
        await screen.findByRole("button", {
            name: "Key for this conversation: Organization key",
        });

        fireEvent.change(screen.getByRole("combobox"), {
            target: { value: "hello" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: "gpt-6-luna",
                    credential_ref: "org:o1:openai:v4",
                }),
            ),
        );
    });

    it("offers no key choice in a review chat", () => {
        mockProfile(false);
        render(
            <ChatInput
                offerCredentialChoice={false}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );
        expect(getChatCredentialOptions).not.toHaveBeenCalled();
        expect(
            screen.queryByRole("button", { name: /Key for this conversation/ }),
        ).toBeNull();
    });
});
