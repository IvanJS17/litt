import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loadMessages } from "@litt/i18n";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ProjectWorkspaceViewSwitcher } from "./ProjectWorkspaceViewSwitcher";

describe("ProjectWorkspaceViewSwitcher", () => {
    it("names the group and marks the view on screen with aria-pressed", () => {
        render(<ProjectWorkspaceViewSwitcher view="explorer" onChange={vi.fn()} />);

        const group = screen.getByRole("group", { name: "Workspace view" });
        const buttons = within(group).getAllByRole("button");
        expect(buttons.map((b) => b.textContent)).toEqual([
            "Chat",
            "Explorer",
            "Document",
        ]);
        expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
            "false",
            "true",
            "false",
        ]);
        for (const button of buttons) {
            expect(button).toHaveAttribute("type", "button");
            expect(button).toHaveClass("focus-visible:ring-2");
        }
    });

    it("reports the chosen view, from the keyboard too", async () => {
        const onChange = vi.fn();
        render(<ProjectWorkspaceViewSwitcher view="chat" onChange={onChange} />);

        await userEvent.click(screen.getByRole("button", { name: "Document" }));
        expect(onChange).toHaveBeenLastCalledWith("document");

        await userEvent.tab({ shift: true });
        expect(screen.getByRole("button", { name: "Explorer" })).toHaveFocus();
        await userEvent.keyboard("{Enter}");
        expect(onChange).toHaveBeenLastCalledWith("explorer");
    });

    it("speaks Mexican Spanish", async () => {
        const messages = await loadMessages("es-MX");
        render(
            <IntlClientProvider locale="es-MX" messages={messages}>
                <ProjectWorkspaceViewSwitcher view="document" onChange={vi.fn()} />
            </IntlClientProvider>,
        );

        const group = screen.getByRole("group", {
            name: "Vista del espacio de trabajo",
        });
        expect(
            within(group)
                .getAllByRole("button")
                .map((b) => b.textContent),
        ).toEqual(["Chat", "Explorador", "Documento"]);
        expect(
            within(group).getByRole("button", { name: "Documento" }),
        ).toHaveAttribute("aria-pressed", "true");
    });
});
