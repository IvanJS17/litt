import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ProjectPracticeField } from "./ProjectPracticeField";
import { projectPracticeLabel } from "../workflows/practices";

function renderEs(value: string, onChange = vi.fn()) {
    render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            <ProjectPracticeField id="practice" value={value} onChange={onChange} />
        </IntlClientProvider>,
    );
    return onChange;
}

describe("ProjectPracticeField", () => {
    it("shows the saved English value in Spanish", () => {
        renderEs("Corporate and M&A");
        expect(screen.getByRole("button", { name: "Corporativo y fusiones y adquisiciones" })).toBeInTheDocument();
    });

    it("lists Spanish labels but stores the English value", async () => {
        const user = userEvent.setup({ delay: null });
        const onChange = renderEs("");
        await user.click(screen.getByRole("button"));
        expect(screen.getByText("Transacciones generales")).toBeInTheDocument();
        expect(screen.queryByText("General Transactions")).not.toBeInTheDocument();
        await user.click(screen.getByText("Transacciones generales"));
        expect(onChange).toHaveBeenCalledWith("General Transactions");
    });

    it("shows a hand-typed practice as saved", () => {
        expect(projectPracticeLabel("Derecho minero", ((k: string) => k) as never)).toBe("Derecho minero");
    });
});
