import { useCallback, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingEffectiveStage, TrainingTurnNote } from "@mike/contracts";
import type { Message, Project } from "@/app/components/shared/types";
import type { ComposerDraftStore } from "@/app/components/assistant/ChatInput";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { getTrainingStage, getTrainingTurnNotes } from "@/app/lib/mikeApi";
import { loadAssistantChat } from "@/app/lib/assistantTurns";
import { isTrainingRefusalCode, markTrainingStageStale, requestTrainingReply } from "@mike/ui";
import { ProjectChatPanel } from "./ProjectChatPanel";

// «Tu turno primero» in a project chat: once a chat has a message, the
// training block of the composer (approach, thermometer, hint controls) is
// folded into one line so the conversation has the room; it opens again when
// the person starts another message.

const ATTEMPT = "Creo que procede la rescisión por incumplimiento de la cláusula quinta del contrato.";
const QUESTION = "¿Procede la rescisión del contrato de arrendamiento?";

const chatState = vi.hoisted(() => ({
    sent: [] as Message[],
    reply: null as Message | null,
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getTrainingStage: vi.fn(),
    getTrainingTurnNotes: vi.fn(),
    getMyTraining: vi.fn(async () => []),
    listWorkflows: vi.fn(async () => []),
    getChatCredentialOptions: vi.fn(async () => ({ provider: "openai", options: [], default: null })),
    deleteChat: vi.fn(),
}));
vi.mock("@/app/lib/assistantTurns", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/assistantTurns")>()),
    loadAssistantChat: vi.fn(),
}));
// The transport is not under test: a turn appends the user message and, when
// the test says so, the answer.
vi.mock("@/app/hooks/useAssistantChat", () => ({
    useAssistantChat: () => {
        const [messages, setMessages] = useState<Message[]>([]);
        const handleChat = useCallback(async (message: Message) => {
            const stored = { ...message, id: "m-user-2" };
            chatState.sent.push(message);
            setMessages((current) => [
                ...current,
                stored,
                ...(chatState.reply ? [chatState.reply] : []),
            ]);
            return null;
        }, []);
        return {
            messages,
            setMessages,
            rejectedApiKey: null,
            dismissInvalidApiKey: vi.fn(),
            isResponseLoading: false,
            handleChat,
            cancel: vi.fn(),
            detach: vi.fn(),
            resetChat: vi.fn(),
        };
    },
}));
vi.mock("@/app/hooks/useWebTrainingBacking", () => ({ useWebTrainingBacking: () => null }));
vi.mock("@/app/components/training/criterion/BackingPanel", () => ({ BackingSlot: () => null }));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({
        setCurrentChatId: vi.fn(),
        newChatMessages: null,
        setNewChatMessages: vi.fn(),
        renameChat: vi.fn(),
    }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "u-pasante", email: "pasante@example.test" }, authLoading: false }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({ useUserProfile: vi.fn() }));
vi.mock("@/app/hooks/useConfiguredModels", () => ({ useConfiguredModels: () => [] }));
vi.mock("@/app/lib/modelAvailability", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/modelAvailability")>()),
    isModelAvailable: vi.fn(() => true),
}));
vi.mock("@/app/components/assistant/ModelToggle", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/components/assistant/ModelToggle")>()),
    ModelToggle: () => null,
}));
vi.mock("@/app/components/assistant/AddDocButton", () => ({ AddDocButton: () => null }));
vi.mock("@/app/components/assistant/UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("@/app/components/modals/AddDocumentsModal", () => ({ AddDocumentsModal: () => null }));
vi.mock("@/app/components/assistant/AssistantWorkflowModal", () => ({ AssistantWorkflowModal: () => null }));
vi.mock("@/app/components/assistant/AssistantMessage", () => ({
    AssistantMessage: ({ events }: { events?: { type: string; text?: string }[] }) => (
        <div data-testid="assistant-message">{events?.map((e) => e.text).join("")}</div>
    ),
}));
vi.mock("@/app/components/shared/ChatPanelHeader", () => ({ ChatPanelHeader: () => null }));

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const PASANTE: TrainingEffectiveStage = {
    stage: "pasante",
    attempt_required: true,
    confidence_required: true,
    urgency_pass: null,
    modes: ["hint", "counterpart"],
    next_hint_level: 1,
    counterpart_next_step: 1,
};
const LAWYER: TrainingEffectiveStage = {
    stage: null,
    attempt_required: false,
    confidence_required: false,
    urgency_pass: null,
    modes: [],
    next_hint_level: null,
    counterpart_next_step: null,
};

const PROJECT = {
    id: "p1",
    name: "Arrendamiento",
    access_role: "editor",
    is_owner: false,
    documents: [],
} as unknown as Project;

function note(overrides: Partial<TrainingTurnNote> = {}): TrainingTurnNote {
    return {
        id: "n1",
        org_id: "org-1",
        trainee_user_id: "u-pasante",
        chat_id: "chat-1",
        message_id: "m-user-1",
        attempt: ATTEMPT,
        contrast: "Coincide: la cláusula quinta aplica.",
        contrast_status: "ready",
        created_at: "2026-11-25T10:00:00.000Z",
        confidence: 3,
        ...overrides,
    };
}

const STORED: Message[] = [
    { id: "m-user-1", role: "user", content: QUESTION },
    {
        id: "m-asst-1",
        role: "assistant",
        content: "Sí procede.",
        events: [{ type: "content", text: "Sí procede." }],
    } as Message,
];

function Panel({ chatId, draftStore }: { chatId: string; draftStore?: ComposerDraftStore }) {
    return (
        <ProjectChatPanel
            projectId="p1"
            project={PROJECT}
            projectLoaded
            chatId={chatId}
            openChat={vi.fn()}
            adoptChat={vi.fn()}
            claimCreated={() => false}
            draftStore={draftStore}
            width={600}
            roundedClassName=""
            chats={[]}
            chatsLoading={false}
            setProjectChats={vi.fn()}
            responseStatuses={{}}
            onClearResponseStatus={vi.fn()}
            displayedDoc={null}
            activeCitation={null}
            resolvingEdits={{}}
            resolvedEditStatuses={{}}
            onDocClick={vi.fn()}
            onCitationClick={vi.fn()}
            onOpenDocument={vi.fn()}
            onEditViewClick={vi.fn()}
            onEditResolveStart={vi.fn()}
            onEditResolved={vi.fn()}
            onEditError={vi.fn()}
            onProjectMutated={vi.fn()}
            onOpenMemory={vi.fn()}
            onEditorGate={vi.fn()}
            onOwnerGate={vi.fn()}
            onActionError={vi.fn()}
            onActivate={vi.fn()}
        />
    );
}

const FIRST_LABEL = "Your approach (2–3 lines)";
const NEXT_LABEL = "Your approach for the next question (2–3 lines)";
const NEXT_LINE = /approach will be asked for/i;

function approachField(label = NEXT_LABEL) {
    return screen.queryByRole("textbox", { name: label });
}
function nextLine() {
    return screen.queryByRole("button", { name: NEXT_LINE });
}
function thermometer() {
    return screen.queryByRole("radiogroup");
}
function box() {
    return screen.getByPlaceholderText("How can I help?");
}
async function openedChat() {
    render(<Panel chatId="chat-1" />);
    await screen.findByText(QUESTION);
    await waitFor(() => expect(privateNote()).not.toBeNull());
    // The notes and the stage are two reads: wait for the folded line, which
    // the stage draws, before the test acts on the block.
    await waitFor(() => expect(nextLine()).not.toBeNull());
    return nextLine();
}

function privateNote() {
    return screen.queryByRole("region", { name: "Private training notes" });
}

describe("ProjectChatPanel — the training block folds after a message", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        chatState.sent = [];
        chatState.reply = null;
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
        window.localStorage.clear();
        vi.mocked(useUserProfile).mockReturnValue({
            profile: {
                displayName: "Pasante",
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
        vi.mocked(getTrainingStage).mockResolvedValue(PASANTE);
        vi.mocked(getTrainingTurnNotes).mockResolvedValue([note()]);
        vi.mocked(loadAssistantChat).mockResolvedValue({
            chat: { id: "chat-1", title: "Rescisión", model: "gpt-6-luna" },
            messages: STORED,
        } as unknown as Awaited<ReturnType<typeof loadAssistantChat>>);
    });

    it("a chat with messages and nothing typed: no field, no thermometer, one line that announces the next approach", async () => {
        const line = await openedChat();
        expect(line).not.toBeNull();
        expect(line).toHaveAttribute("aria-expanded", "false");
        expect(approachField()).toBeNull();
        expect(approachField(FIRST_LABEL)).toBeNull();
        expect(thermometer()).toBeNull();
        // The earlier approach is shown once, in the note, under the history heading.
        expect(within(privateNote()!).getByText("The approach you sent")).toBeInTheDocument();
        expect(screen.getAllByText(ATTEMPT)).toHaveLength(1);
        expect(box()).toBeEnabled();
    });

    it.each([
        ["a click in the input", () => fireEvent.click(box())],
        ["typing a character", () => fireEvent.change(box(), { target: { value: "¿" } })],
        ["activating the line", () => fireEvent.click(nextLine()!)],
    ])("%s opens the block with the next-question label", async (_how, act_) => {
        await openedChat();
        act_();
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        expect(field).toHaveValue("");
        expect(thermometer()).not.toBeNull();
        expect(screen.getByRole("button", { name: NEXT_LINE })).toHaveAttribute("aria-expanded", "true");
    });

    it("focus alone leaves the block folded: the input is focused again each time the window comes back", async () => {
        await openedChat();
        fireEvent.focus(box());
        expect(nextLine()).toHaveAttribute("aria-expanded", "false");
        expect(approachField()).toBeNull();
        expect(thermometer()).toBeNull();
    });

    it("the line folds an open, empty block again, and leads to the approach once something is written", async () => {
        await openedChat();
        fireEvent.click(box());
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.click(nextLine()!);
        expect(nextLine()).toHaveAttribute("aria-expanded", "false");
        expect(approachField()).toBeNull();

        fireEvent.click(nextLine()!);
        const again = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.change(again, { target: { value: "Borrador del planteamiento" } });
        fireEvent.click(nextLine()!);
        expect(nextLine()).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("textbox", { name: NEXT_LABEL })).toHaveValue("Borrador del planteamiento");
        expect(field).not.toBeNull();
    });

    it("activating the line puts the cursor in the approach field", async () => {
        await openedChat();
        fireEvent.click(nextLine()!);
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        await waitFor(() => expect(document.activeElement).toBe(field));
    });

    it("send, answer arrives: the block folds again and the sent approach shows once under the history heading", async () => {
        chatState.reply = {
            role: "assistant",
            content: "Sí procede.",
            events: [{ type: "content", text: "Sí procede." }],
        } as Message;
        // The server stores the turn's note; it is read when the chat is open.
        vi.mocked(getTrainingTurnNotes).mockResolvedValue([note({ message_id: "m-user-2" })]);
        await openedChatWithoutNote();
        fireEvent.click(box());
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.change(field, { target: { value: ATTEMPT } });
        fireEvent.click(screen.getByRole("radio", { name: /Fairly sure/ }));
        fireEvent.change(box(), { target: { value: QUESTION } });
        fireEvent.keyDown(box(), { key: "Enter" });
        // What is sent is exactly what it was.
        expect(chatState.sent).toHaveLength(1);
        expect(chatState.sent[0]).toMatchObject({ attempt: ATTEMPT, confidence: 3 });
        await waitFor(() => expect(nextLine()).toHaveAttribute("aria-expanded", "false"));
        expect(approachField()).toBeNull();
        expect(thermometer()).toBeNull();
        expect(screen.getAllByTestId("assistant-message").length).toBeGreaterThan(0);
        // The approach just sent is read once, in the note, as history.
        await waitFor(() => expect(privateNote()).not.toBeNull());
        const region = privateNote()!;
        expect(within(region).getByText("The approach you sent")).toBeInTheDocument();
        expect(screen.getAllByText(ATTEMPT)).toHaveLength(1);
    });

    it("a brand-new chat with no message asks for the first approach, expanded", async () => {
        vi.mocked(getTrainingTurnNotes).mockResolvedValue([]);
        render(<Panel chatId="" />);
        expect(await screen.findByRole("textbox", { name: FIRST_LABEL })).toBeInTheDocument();
        expect(thermometer()).not.toBeNull();
        expect(nextLine()).toBeNull();
    });

    it("a brand-new chat folds after its first message is sent", async () => {
        vi.mocked(getTrainingTurnNotes).mockResolvedValue([]);
        render(<Panel chatId="" />);
        fireEvent.change(await screen.findByRole("textbox", { name: FIRST_LABEL }), { target: { value: ATTEMPT } });
        fireEvent.click(screen.getByRole("radio", { name: /Fairly sure/ }));
        fireEvent.change(box(), { target: { value: QUESTION } });
        fireEvent.keyDown(box(), { key: "Enter" });
        expect(chatState.sent[0]).toMatchObject({ attempt: ATTEMPT, confidence: 3 });
        await waitFor(() => expect(nextLine()).toHaveAttribute("aria-expanded", "false"));
        expect(approachField(FIRST_LABEL)).toBeNull();
        expect(approachField()).toBeNull();
    });

    it("an approach already written is never folded away, and a «Responder» opens the block", async () => {
        await openedChat();
        fireEvent.click(box());
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.change(field, { target: { value: "Borrador del planteamiento" } });
        // Leaving the input does not fold what holds text.
        fireEvent.blur(box());
        expect(screen.getByRole("textbox", { name: NEXT_LABEL })).toHaveValue("Borrador del planteamiento");
        cleanup();

        await openedChat();
        expect(approachField()).toBeNull();
        // A «Responder» is heard only by a composer whose stage asks for an
        // approach, and that listener is registered in an effect React may
        // run after the line is painted: ask until the field is there.
        await waitFor(() => {
            act(() => requestTrainingReply("¿En qué precepto se apoya?", "chat-1"));
            expect(approachField()).not.toBeNull();
        });
        const prefilled = await screen.findByRole("textbox", { name: NEXT_LABEL });
        expect((prefilled as HTMLTextAreaElement).value).toContain("> ¿En qué precepto se apoya?");
    });

    it("a mark already chosen keeps the block open", async () => {
        await openedChat();
        fireEvent.click(nextLine()!);
        await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.click(screen.getByRole("radio", { name: /Sure$/ }));
        fireEvent.blur(box());
        expect(thermometer()).not.toBeNull();
        expect(approachField()).not.toBeNull();
    });

    it("a hint keeps the approach and the mark, so the block stays open", async () => {
        await openedChat();
        fireEvent.click(nextLine()!);
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.change(field, { target: { value: ATTEMPT } });
        fireEvent.change(box(), { target: { value: QUESTION } });
        fireEvent.click(screen.getByRole("button", { name: /Ask for a hint/ }));
        expect(chatState.sent[0]).toMatchObject({ attempt: ATTEMPT, training_mode: "hint" });
        expect(screen.getByRole("textbox", { name: NEXT_LABEL })).toHaveValue(ATTEMPT);
        expect(thermometer()).not.toBeNull();
    });

    it("after a hint, emptying the approach field does not fold the block while the person edits", async () => {
        await openedChat();
        fireEvent.click(nextLine()!);
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.change(field, { target: { value: ATTEMPT } });
        fireEvent.change(box(), { target: { value: QUESTION } });
        fireEvent.click(screen.getByRole("button", { name: /Ask for a hint/ }));
        fireEvent.change(screen.getByRole("textbox", { name: NEXT_LABEL }), { target: { value: "" } });
        expect(screen.getByRole("textbox", { name: NEXT_LABEL })).toHaveValue("");
        expect(thermometer()).not.toBeNull();
    });

    it("a refused send from a restored draft (nothing focused, nothing typed) opens the block with the error", async () => {
        const draftStore: ComposerDraftStore = new Map([["chat-1", { value: QUESTION, attachedDocs: [] }]]);
        render(<Panel chatId="chat-1" draftStore={draftStore} />);
        await waitFor(() => expect(nextLine()).not.toBeNull());
        expect(approachField()).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        expect(chatState.sent).toHaveLength(0);
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("a refused send (approach too short) opens the block and shows the error", async () => {
        await openedChat();
        fireEvent.click(box());
        fireEvent.change(box(), { target: { value: QUESTION } });
        fireEvent.keyDown(box(), { key: "Enter" });
        expect(chatState.sent).toHaveLength(0);
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        expect(field).toHaveAttribute("aria-invalid", "true");
    });

    it("a refused send (no mark) shows the mark error", async () => {
        await openedChat();
        fireEvent.click(box());
        const field = await screen.findByRole("textbox", { name: NEXT_LABEL });
        fireEvent.change(field, { target: { value: ATTEMPT } });
        fireEvent.change(box(), { target: { value: QUESTION } });
        fireEvent.keyDown(box(), { key: "Enter" });
        expect(chatState.sent).toHaveLength(0);
        expect(screen.getByRole("alert")).toHaveTextContent("Mark how sure you are before sending.");
    });

    it.each(["training_attempt_required", "training_confidence_required"])(
        "the server's %s opens the block again",
        async (code) => {
            await openedChat();
            expect(approachField()).toBeNull();
            // The chat hook announces a refusal with this window event
            // (useAssistantChat.ts, for exactly these two codes).
            expect(isTrainingRefusalCode(code)).toBe(true);
            act(() => markTrainingStageStale());
            expect(await screen.findByRole("textbox", { name: NEXT_LABEL })).toBeInTheDocument();
            expect(thermometer()).not.toBeNull();
        },
    );

    it("control: a lawyer sees no field, no line and the composer unchanged", async () => {
        vi.mocked(getTrainingStage).mockResolvedValue(LAWYER);
        vi.mocked(getTrainingTurnNotes).mockRejectedValue(new Error("404"));
        render(<Panel chatId="chat-1" />);
        await screen.findByText(QUESTION);
        await waitFor(() => expect(vi.mocked(getTrainingStage)).toHaveBeenCalled());
        await act(async () => {});
        expect(nextLine()).toBeNull();
        expect(approachField()).toBeNull();
        expect(approachField(FIRST_LABEL)).toBeNull();
        expect(thermometer()).toBeNull();
        expect(box()).toBeEnabled();
    });

    it("a stale stage that was read as 'no attempt needed' opens the block once it is read again", async () => {
        // The browser's stage said nothing is asked; the server then refuses
        // the send. The stage is read again and the block must come back open.
        vi.mocked(getTrainingStage).mockResolvedValue(LAWYER);
        render(<Panel chatId="chat-1" />);
        await screen.findByText(QUESTION);
        await waitFor(() => expect(vi.mocked(getTrainingStage)).toHaveBeenCalledTimes(1));
        await act(async () => {});
        expect(nextLine()).toBeNull();
        expect(approachField()).toBeNull();
        vi.mocked(getTrainingStage).mockResolvedValue(PASANTE);
        act(() => markTrainingStageStale());
        const line = await screen.findByRole("button", { name: NEXT_LINE });
        expect(line).toHaveAttribute("aria-expanded", "true");
        expect(await screen.findByRole("textbox", { name: NEXT_LABEL })).toBeInTheDocument();
    });

    it("nothing is drawn when the stage is stale and no attempt is needed", async () => {
        vi.mocked(getTrainingStage).mockResolvedValue(LAWYER);
        render(<Panel chatId="chat-1" />);
        await screen.findByText(QUESTION);
        await waitFor(() => expect(vi.mocked(getTrainingStage)).toHaveBeenCalledTimes(1));
        await act(async () => {});
        act(() => markTrainingStageStale());
        await waitFor(() => expect(vi.mocked(getTrainingStage)).toHaveBeenCalledTimes(2));
        await act(async () => {});
        expect(nextLine()).toBeNull();
        expect(approachField()).toBeNull();
        expect(thermometer()).toBeNull();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(box()).toBeEnabled();
    });
});

async function openedChatWithoutNote() {
    render(<Panel chatId="chat-1" />);
    await screen.findByText(QUESTION);
    await waitFor(() => expect(nextLine()).not.toBeNull());
}
