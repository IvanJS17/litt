import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ChatPanelHeader } from "./ChatPanelHeader";

describe("ChatPanelHeader in es-MX", () => {
    it("names an untitled chat in Spanish", () => {
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <ChatPanelHeader
                    chats={[{ id: "chat-1", title: null }]}
                    currentChatId="chat-1"
                    currentTitle={null}
                    onLoad={vi.fn()}
                    onNewChat={vi.fn()}
                    actions={null}
                />
            </IntlClientProvider>,
        );
        expect(screen.getByText("Nuevo chat")).toBeInTheDocument();
        expect(screen.queryByText("New chat")).toBeNull();
    });
});
