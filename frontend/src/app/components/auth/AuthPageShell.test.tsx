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

    it("tightens the frame and draws the wordmark at X = 33 in a short window", () => {
        const { container } = render(
            <AuthPageShell>
                <p>card</p>
            </AuthPageShell>,
        );
        const frame = container.firstElementChild as HTMLElement;
        const area = screen.getByText("card").parentElement as HTMLElement;
        const logoBox = frame.firstElementChild as HTMLElement;
        // The three height ranges never overlap, so no rule fights another.
        expect(frame.className).toContain("[@media(max-height:700px)]:py-2");
        expect(frame.className).toContain(
            "[@media(min-height:701px)_and_(max-height:860px)]:py-6",
        );
        expect(frame.className).toContain("[@media(min-height:861px)]:md:py-10");
        expect(area.className).toContain("[@media(max-height:700px)]:pt-1");
        expect(area.className).toContain("[@media(max-height:700px)]:pb-0");
        // 108 × 56 px is 36u × 18.371u at u = 3 px: the brand's X = 33.
        expect(logoBox.className).toContain(
            "[@media(max-height:700px)]:[&_[data-slot=litt-wordmark]]:w-[108px]",
        );
        expect(logoBox.className).toContain(
            "[@media(max-height:700px)]:[&_[data-slot=litt-wordmark]]:h-[56px]",
        );
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
