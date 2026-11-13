import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InitialView } from "./InitialView";

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { email: "abogado@example.test" } }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            displayName: "Abogado Lote Uno Con Un Nombre Muy Largo",
            quickActionsVisible: true,
        },
    }),
}));
vi.mock("./ChatInput", () => ({
    ChatInput: () => <div data-testid="chat-input" />,
}));

function renderView() {
    return render(
        <InitialView
            onSubmit={() => {}}
            quickActions={[]}
            onEditQuickActions={() => {}}
        />,
    );
}

describe("InitialView on a phone", () => {
    it("lets a long greeting wrap instead of pushing the chat box off screen", () => {
        const { container } = renderView();
        const greeting = screen.getByRole("heading", { level: 1 });
        expect(greeting).not.toHaveClass("whitespace-nowrap");
        expect(greeting).toHaveClass("min-w-0", "break-words", "text-3xl");
        // The only grid column may never grow past the screen.
        expect(container.firstElementChild).toHaveClass(
            "grid-cols-[minmax(0,1fr)]",
        );
    });

    it("keeps the quick-actions gear visible and 44 px tall to a finger", () => {
        renderView();
        const gear = screen.getByRole("button", {
            name: /quick actions/i,
        });
        expect(gear).toHaveClass("pointer-coarse:opacity-100");
        expect(gear.className).toContain("pointer-coarse:after:size-11");
        expect(gear).toHaveClass("absolute");
        expect(gear).not.toHaveClass("relative");
    });
});
