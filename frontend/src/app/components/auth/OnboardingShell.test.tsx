import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingShell } from "./OnboardingShell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("OnboardingShell", () => {
    it("tightens the card in a short window so a step does not scroll for a few pixels", () => {
        render(
            <OnboardingShell step="Step 1 of 2" title="Your practice">
                <p>body</p>
            </OnboardingShell>,
        );
        const card = screen.getByRole("heading", { name: "Your practice" }).parentElement as HTMLElement;
        expect(card.className).toContain("p-8");
        expect(card.className).toContain("[@media(max-height:700px)]:p-5");
        expect(screen.getByText("body").parentElement?.className).toContain("[@media(max-height:700px)]:mt-4");
    });
});
