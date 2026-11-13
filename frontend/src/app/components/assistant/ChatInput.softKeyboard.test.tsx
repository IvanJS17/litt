import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { resetPhysicalKeyboardForTests } from "@/app/hooks/useSoftKeyboard";
import { ChatInput } from "./ChatInput";

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(async () => []),
    uploadStandaloneDocument: vi.fn(),
    uploadProjectDocuments: vi.fn(),
    uploadStandaloneDocuments: vi.fn(),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({ useUserProfile: vi.fn() }));
vi.mock("@/app/hooks/useSelectedModel", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/hooks/useSelectedModel")>()),
    useSelectedModel: () => ["claude-sonnet-4-6", vi.fn()],
}));
vi.mock("@/app/hooks/useConfiguredModels", () => ({ useConfiguredModels: () => [] }));
vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));
vi.mock("./ModelToggle", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./ModelToggle")>()),
    ModelToggle: () => null,
}));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({ AddDocumentsModal: () => null }));
vi.mock("./AssistantWorkflowModal", () => ({ AssistantWorkflowModal: () => null }));
vi.mock("../playbooks/PlaybookPickerModal", () => ({ PlaybookPickerModal: () => null }));
vi.mock("../popups/ApiKeyMissingPopup", () => ({ ApiKeyMissingPopup: () => null }));

class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
}

function stubPointer(coarse: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: coarse && query === "(pointer: coarse)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
    }));
}

function renderInput() {
    const onSubmit = vi.fn();
    render(
        <ChatInput onSubmit={onSubmit} onCancel={vi.fn()} isLoading={false} canSend offerCredentialChoice={false} />,
    );
    const box = screen.getByPlaceholderText("How can I help?") as HTMLTextAreaElement;
    return { box, onSubmit };
}

describe("ChatInput on-screen keyboard", () => {
    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        resetPhysicalKeyboardForTests();
        vi.mocked(useUserProfile).mockReturnValue({
            profile: { openRouterModels: [], vercelModels: [], openCodeGoModels: [], apiKeys: {} },
            loading: false,
            apiKeysDegraded: false,
        } as unknown as ReturnType<typeof useUserProfile>);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("on a touch screen Enter is a line break and the arrow sends", async () => {
        stubPointer(true);
        const { box, onSubmit } = renderInput();
        expect(box).toHaveAttribute("enterkeyhint", "enter");
        await userEvent.type(box, "Hola");
        // Not prevented: the browser inserts the line break.
        const notPrevented = fireEvent.keyDown(box, { key: "Enter" });
        expect(notPrevented).toBe(true);
        expect(onSubmit).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole("button", { name: "Send message" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    });

    it("closes the keyboard (blurs the box) when sending from a touch screen", async () => {
        stubPointer(true);
        const { box } = renderInput();
        await userEvent.type(box, "Hola");
        expect(box).toHaveFocus();
        await userEvent.click(screen.getByRole("button", { name: "Send message" }));
        expect(box).not.toHaveFocus();
    });

    it("with a mouse, Enter sends, Shift+Enter breaks the line, and focus stays", async () => {
        stubPointer(false);
        const { box, onSubmit } = renderInput();
        expect(box).toHaveAttribute("enterkeyhint", "send");
        await userEvent.type(box, "Hola");
        expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(true);
        expect(onSubmit).not.toHaveBeenCalled();
        expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
        await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    });

    it("a touch screen with a physical keyboard (Tab seen) keeps Enter to send", async () => {
        stubPointer(true);
        const { box, onSubmit } = renderInput();
        await userEvent.type(box, "Hola");
        fireEvent.keyDown(window, { key: "Tab" });
        await waitFor(() => expect(box).toHaveAttribute("enterkeyhint", "send"));
        expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
        await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
        // And the box keeps the focus, as on a desktop.
        expect(box).toHaveFocus();
    });
});
