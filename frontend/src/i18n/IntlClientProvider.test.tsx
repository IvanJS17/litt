import { render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMessages, type Messages } from "@litt/i18n";
import { clientLocale, describeError } from "@mike/client";
import { IntlClientProvider } from "./IntlClientProvider";

function SaveButton() {
    const t = useTranslations("common");
    return <button type="button">{t("save")}</button>;
}

describe("IntlClientProvider", () => {
    afterEach(() => vi.restoreAllMocks());

    it("shows a common.* message in Spanish for es-MX", async () => {
        const messages = await loadMessages("es-MX");
        render(
            <IntlClientProvider locale="es-MX" messages={messages}>
                <SaveButton />
            </IntlClientProvider>,
        );
        expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
    });

    it("points @mike/client's failure messages at its locale before children render", async () => {
        const messages = await loadMessages("es-MX");
        function Failure() {
            return <p>{describeError(new TypeError("Failed to fetch")).title}</p>;
        }
        render(
            <IntlClientProvider locale="es-MX" messages={messages}>
                <Failure />
            </IntlClientProvider>,
        );
        expect(clientLocale()).toBe("es-MX");
        expect(screen.getByText("Problema de conexión")).toBeInTheDocument();
    });

    it("renders a missing key as its path instead of breaking the page", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const messages = { common: {} } as unknown as Messages;
        function Missing() {
            const t = useTranslations("common");
            return <p>{t("save")}</p>;
        }
        render(
            <IntlClientProvider locale="es-MX" messages={messages}>
                <Missing />
            </IntlClientProvider>,
        );
        expect(screen.getByText("common.save")).toBeInTheDocument();
        expect(warn).toHaveBeenCalled();
    });
});
