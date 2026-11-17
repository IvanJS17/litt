import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarChatItem } from "./SidebarChatItem";
import type { Chat } from "@/app/components/shared/types";

// A conversation a connected app started says so, in plain text.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/contexts/ChatHistoryContext", () => ({
    useChatHistoryContext: () => ({ renameChat: vi.fn(), deleteChat: vi.fn(), leaveChat: vi.fn() }),
}));
vi.mock("@/app/components/assistant/ChatAccessModal", () => ({ ChatAccessModal: () => null }));

const chat = (overrides: Partial<Chat>): Chat =>
    ({
        id: "chat-1",
        project_id: null,
        title: "Renta del contrato",
        user_id: "me",
        created_at: new Date().toISOString(),
        is_owner: true,
        ...overrides,
    }) as Chat;

const renderRow = (c: Chat) => render(<SidebarChatItem chat={c} isActive={false} onSelect={vi.fn()} />);

describe("SidebarChatItem origin", () => {
    it("shows 'From <app>' beside the title and in the row's name", () => {
        renderRow(chat({ origin: "mcp", origin_label: " Claude " }));
        expect(screen.getByText("From Claude")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Renta del contrato (From Claude)" })).toBeTruthy();
    });

    it.each<[string, Partial<Chat>]>([
        ["a chat from the web", { origin: "web", origin_label: null }],
        ["a chat with no origin at all", {}],
        ["an app chat whose app has no name", { origin: "mcp", origin_label: "   " }],
        ["an app chat with a null name", { origin: "mcp", origin_label: null }],
        ["a Word chat", { origin: "word", origin_label: "Word" }],
    ])("says nothing for %s", (_name, over) => {
        renderRow(chat(over));
        expect(screen.queryByText(/^From /)).toBeNull();
        expect(screen.getByRole("button", { name: "Renta del contrato" })).toBeTruthy();
    });
});
