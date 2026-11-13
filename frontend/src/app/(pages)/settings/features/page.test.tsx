import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FeaturesPage from "./page";

const state = vi.hoisted(() => ({
    updateResponseDetailsVisible: vi.fn(),
    firm: null as null | { name: string },
    managed: false,
}));

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
    useWorkspace: () => ({ activeOrganization: state.firm, orgApiKeys: null }),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getUserSplitClasses: vi.fn(() => new Promise(() => {})),
    saveUserSplitClasses: vi.fn(),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            quickActionsVisible: true,
            personalWorkspaceDisabled: state.managed,
        },
        updateQuickActionsVisible: vi.fn(),
        updateResponseDetailsVisible: state.updateResponseDetailsVisible,
    }),
}));

vi.mock("@/app/components/settings/ScanReadingSection", () => ({
    ScanReadingSection: () => null,
}));
vi.mock("@/app/components/settings/WebSearchSection", () => ({
    WebSearchSection: () => null,
}));

describe("FeaturesPage document types to split a case file", () => {
    const card = () => screen.queryByRole("region", { name: "Document types for splitting a file" });

    it("shows the personal list in the personal workspace", () => {
        state.firm = null;
        state.managed = false;
        render(<FeaturesPage />);
        expect(card()).toBeInTheDocument();
    });

    it("does not show it inside a firm's workspace: the firm's list governs there", () => {
        state.firm = { name: "Socium" };
        state.managed = false;
        render(<FeaturesPage />);
        expect(card()).not.toBeInTheDocument();
    });

    it("does not show it for a firm-managed account, which has no personal workspace", () => {
        state.firm = null;
        state.managed = true;
        render(<FeaturesPage />);
        expect(card()).not.toBeInTheDocument();
    });
});

describe("FeaturesPage response details", () => {
    beforeEach(() => {
        state.firm = null;
        state.managed = false;
    });

    it("starts off and saves the user's choice", async () => {
        state.updateResponseDetailsVisible.mockResolvedValue(true);
        const user = userEvent.setup();
        render(<FeaturesPage />);

        const toggle = screen.getByRole("switch", { name: "Response details" });
        expect(toggle).toHaveAttribute("aria-checked", "false");
        await user.click(toggle);
        await waitFor(() =>
            expect(state.updateResponseDetailsVisible).toHaveBeenCalledWith(true),
        );
    });
});
