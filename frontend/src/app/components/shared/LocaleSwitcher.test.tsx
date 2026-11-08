import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMessages } from "@litt/i18n";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { LocaleSwitcher } from "./LocaleSwitcher";

const { refresh, setLocale } = vi.hoisted(() => ({
    refresh: vi.fn(),
    setLocale: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/lib/localeActions", () => ({ setLocale }));

describe("LocaleSwitcher", () => {
    beforeEach(() => {
        refresh.mockReset();
        setLocale.mockReset();
        setLocale.mockResolvedValue(true);
    });

    it("is a named control that offers each language in its own language", () => {
        render(<LocaleSwitcher />);
        const select = screen.getByRole("combobox", { name: "Language" });
        expect(select).toHaveValue("en-US");
        expect(screen.getByRole("option", { name: "English" })).toHaveProperty("selected", true);
        expect(screen.getByRole("option", { name: "Español" })).toHaveProperty("selected", false);
        // The visible focus ring is part of the control.
        expect(select.className).toContain("focus-visible:ring-2");
    });

    it("saves the chosen language and refreshes the route without reloading", async () => {
        const user = userEvent.setup();
        render(<LocaleSwitcher />);
        await user.selectOptions(screen.getByRole("combobox"), "es-MX");
        expect(setLocale).toHaveBeenCalledExactlyOnceWith("es-MX");
        await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
        expect(screen.getByRole("combobox")).toHaveValue("es-MX");
    });

    it("names itself in Spanish and marks the current language when the page is es-MX", async () => {
        const messages = await loadMessages("es-MX");
        render(
            <IntlClientProvider locale="es-MX" messages={messages}>
                <LocaleSwitcher />
            </IntlClientProvider>,
        );
        const select = screen.getByRole("combobox", { name: "Idioma" });
        expect(select).toHaveValue("es-MX");
        expect(screen.getByRole("option", { name: "Español" })).toHaveProperty("selected", true);
        expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    });

    it("does nothing when the current language is picked again", async () => {
        const user = userEvent.setup();
        render(<LocaleSwitcher />);
        await user.selectOptions(screen.getByRole("combobox"), "en-US");
        expect(setLocale).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it("ignores a value outside the supported list", () => {
        render(<LocaleSwitcher />);
        const select = screen.getByRole("combobox") as HTMLSelectElement;
        const option = document.createElement("option");
        option.value = "fr-FR";
        select.append(option);
        select.value = "fr-FR";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        expect(setLocale).not.toHaveBeenCalled();
    });

    it("goes back to the shown language and does not refresh when the server refuses", async () => {
        setLocale.mockResolvedValue(false);
        const user = userEvent.setup();
        render(<LocaleSwitcher />);
        await user.selectOptions(screen.getByRole("combobox"), "es-MX");
        await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("en-US"));
        expect(refresh).not.toHaveBeenCalled();
    });
});
