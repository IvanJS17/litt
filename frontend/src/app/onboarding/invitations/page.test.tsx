import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingInvitationsPage from "./page";

const mocks = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    list: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    user: { id: "user-1" } as { id: string } | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks, usePathname: () => "/onboarding/invitations" }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: mocks.user, authLoading: false }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { onboardingComplete: false }, loading: false }),
}));
vi.mock("@/app/lib/mikeApi", async (original) => ({
    ...await original<typeof import("@/app/lib/mikeApi")>(),
    listMyOrgInvitations: mocks.list,
    acceptOrgInvitation: mocks.accept,
    declineOrgInvitation: mocks.decline,
}));
vi.mock("@/app/components/site-logo", () => ({ SiteLogo: () => <div>Mike</div> }));

const invitation = { id: "invite", org_id: "org", org_name: "Example LLP", role: "member", invited_by_email: "dana@example.test" };
const NEXT = "/onboarding/profile?invitations=answered";

describe("OnboardingInvitationsPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        mocks.user = { id: "user-1" };
        mocks.list.mockResolvedValue([invitation]);
        mocks.accept.mockResolvedValue({ org_id: "org", role: "member" });
        mocks.decline.mockResolvedValue(undefined);
    });

    it("asks about the invitation first, with no numbered step or form field", async () => {
        render(<OnboardingInvitationsPage />);
        expect(await screen.findByText("Example LLP invited you to join as Member")).toBeVisible();
        expect(screen.getByRole("heading", { name: "You have a pending invitation" })).toBeVisible();
        expect(screen.queryByText(/^Step /)).not.toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("shows the managed-account notice before Accept, only for an invitation that creates one", async () => {
        mocks.list.mockResolvedValue([
            { ...invitation, managed_account: true },
            { ...invitation, id: "plain", org_name: "Other LLP" },
        ]);
        render(<OnboardingInvitationsPage />);
        const notice = await screen.findByRole("region", { name: "Account managed by Example LLP" });
        expect(notice).toHaveTextContent("you won't have a personal workspace");
        expect(screen.getAllByRole("region", { name: /managed by/ })).toHaveLength(1);
        const accept = screen.getByRole("button", { name: "Accept Example LLP" });
        expect(notice.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("moves on to the profile once the invitation is accepted, in that firm's workspace", async () => {
        const user = userEvent.setup();
        render(<OnboardingInvitationsPage />);
        await user.click(await screen.findByRole("button", { name: "Accept Example LLP" }));
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(NEXT));
        expect(window.localStorage.getItem("mike.activeWorkspace.user-1")).toBe("org");
    });

    it("carries on as a person who signed up alone after declining everything", async () => {
        const user = userEvent.setup();
        render(<OnboardingInvitationsPage />);
        await user.click(await screen.findByRole("button", { name: "Decline Example LLP" }));
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(NEXT));
        expect(window.localStorage.getItem("mike.activeWorkspace.user-1")).toBeNull();
    });

    it("skips straight to the profile when nobody invited the person", async () => {
        mocks.list.mockResolvedValue([]);
        render(<OnboardingInvitationsPage />);
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(NEXT));
    });

    it("offers a way past a failed lookup", async () => {
        mocks.list.mockRejectedValue(new Error("down"));
        const user = userEvent.setup();
        render(<OnboardingInvitationsPage />);
        await user.click(await screen.findByRole("button", { name: "Continue without answering" }));
        expect(mocks.replace).toHaveBeenCalledWith(NEXT);
    });

    it("sends somebody who is not signed in to the login page", async () => {
        mocks.user = null;
        render(<OnboardingInvitationsPage />);
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
    });
});
