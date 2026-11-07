import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthPageShell } from "./AuthPageShell";

describe("AuthPageShell", () => {
    it("puts the wordmark in the flow before the card, never on top of it", () => {
        render(
            <AuthPageShell>
                <p>card</p>
            </AuthPageShell>,
        );
        const logo = screen.getByRole("heading", { name: "LiTT" });
        const card = screen.getByText("card");
        expect(
            logo.compareDocumentPosition(card) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(logo.closest(".absolute")).toBeNull();
        expect(card.parentElement).toHaveAttribute("data-align", "center");
        expect(card.parentElement?.className).toContain("justify-center");
    });

    it("keeps a growing form right under the wordmark with align=top", () => {
        render(
            <AuthPageShell align="top">
                <p>form</p>
            </AuthPageShell>,
        );
        const area = screen.getByText("form").parentElement;
        expect(area).toHaveAttribute("data-align", "top");
        expect(area?.className).not.toContain("justify-center");
    });
});
