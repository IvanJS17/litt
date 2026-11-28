import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { TRMessageBubble } from "./TRChatPanel";

// A review thread says in plain text which message a connected app wrote, with
// the same strings the conversations use.

const bubble = (fromApp?: { name: string | null }) => (
    <IntlClientProvider locale="es-MX" messages={esMX}>
        <TRMessageBubble msg={{ role: "user", content: "¿Procede?", fromApp }} onCitationClick={vi.fn()} />
    </IntlClientProvider>
);

describe("TRMessageBubble for a message a connected app wrote", () => {
    it("says which app the message came from, as text that wraps", () => {
        const name = "<b>Mi app</b> " + "muylargo".repeat(20);
        const { container } = render(bubble({ name }));
        expect(container.querySelector("b")).toBeNull();
        const line = screen.getByText(`Desde ${name}`);
        expect(line.tagName).toBe("P");
        expect(line).toHaveClass("break-words");
    });

    it("says it came from a connected app when the name is missing", () => {
        render(bubble({ name: null }));
        expect(screen.getByText("Desde una app conectada")).toBeInTheDocument();
    });

    it("shows nothing for an ordinary message", () => {
        const { container } = render(bubble());
        expect(container.querySelector("p")).toBeNull();
        expect(screen.getByText("¿Procede?")).toBeInTheDocument();
    });
});
