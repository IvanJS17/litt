import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AssistantPage from "./page";

const state = vi.hoisted(() => ({
    updateResponseDetailsVisible: vi.fn(),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            quickActionsVisible: true,
        },
        updateQuickActionsVisible: vi.fn(),
        updateResponseDetailsVisible: state.updateResponseDetailsVisible,
    }),
}));

describe("AssistantPage response details", () => {
    it("starts off and saves the user's choice", async () => {
        state.updateResponseDetailsVisible.mockResolvedValue(true);
        const user = userEvent.setup();
        render(<AssistantPage />);

        const toggle = screen.getByRole("switch", { name: "Response details" });
        expect(toggle).toHaveAttribute("aria-checked", "false");
        await user.click(toggle);
        await waitFor(() =>
            expect(state.updateResponseDetailsVisible).toHaveBeenCalledWith(true),
        );
    });
});
