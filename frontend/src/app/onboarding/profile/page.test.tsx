import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingProfilePage from "./page";

const { push, replace, reloadProfile, updateUserProfile, listMyOrgInvitations, acceptOrgInvitation, listOrgs, getOrgApiKeys } = vi.hoisted(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    reloadProfile: vi.fn(),
    updateUserProfile: vi.fn(),
    listMyOrgInvitations: vi.fn(),
    acceptOrgInvitation: vi.fn(),
    listOrgs: vi.fn(),
    getOrgApiKeys: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push, replace }),
    usePathname: () => "/onboarding/profile",
    useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "user-1", email: "alex@example.com" },
        authLoading: false,
    }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: {
            displayName: "Alex",
            organisation: "",
        },
        loading: false,
        reloadProfile,
    }),
}));

vi.mock("@/app/lib/mikeApi", async (original) => ({
    ...(await original<typeof import("@/app/lib/mikeApi")>()),
    updateUserProfile,
    listMyOrgInvitations,
    acceptOrgInvitation,
    listOrgs,
    getOrgApiKeys,
}));
vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>Mike</div>,
}));

describe("OnboardingProfilePage", () => {
    beforeEach(() => {
        push.mockReset();
        replace.mockReset();
        reloadProfile.mockReset();
        reloadProfile.mockResolvedValue(undefined);
        updateUserProfile.mockReset();
        updateUserProfile.mockResolvedValue({});
        listMyOrgInvitations.mockReset().mockResolvedValue([]);
        acceptOrgInvitation.mockReset();
        listOrgs.mockReset().mockResolvedValue([{ id: "org-1", name: "Socium", role: "member" }]);
        getOrgApiKeys.mockReset().mockResolvedValue({ effective: {}, allow_personal_keys: { ai: true, web_search: true, scan: true } });
        window.localStorage.clear();
        window.history.replaceState(null, "", "/onboarding/profile");
    });

    it("allows an empty name and saves profile details before continuing", async () => {
        const user = userEvent.setup();
        render(<OnboardingProfilePage />);

        const name = await screen.findByRole("textbox", { name: "Name" });
        await user.clear(name);
        await user.type(
            screen.getByRole("textbox", { name: /Organisation/ }),
            "Example LLP",
        );
        await user.click(screen.getByRole("button", { name: "Continue" }));

        await waitFor(() =>
            expect(updateUserProfile).toHaveBeenCalledWith({
                displayName: null,
                organisation: "Example LLP",
            }),
        );
        expect(reloadProfile).toHaveBeenCalled();
        expect(push).toHaveBeenCalledWith("/onboarding/practice");
        expect(screen.queryByText(/Step 1 of/)).toBeVisible();
    });

    it("sends somebody with a pending firm invitation to answer it first", async () => {
        listMyOrgInvitations.mockResolvedValue([{ id: "invite" }]);
        render(<OnboardingProfilePage />);
        await waitFor(() => expect(replace).toHaveBeenCalledWith("/onboarding/invitations"));
        expect(screen.queryByRole("textbox", { name: "Name" })).not.toBeInTheDocument();
    });

    it("does not ask again once the invitations were answered", async () => {
        window.history.replaceState(null, "", "/onboarding/profile?invitations=answered");
        render(<OnboardingProfilePage />);
        expect(await screen.findByRole("textbox", { name: "Name" })).toBeVisible();
        expect(listMyOrgInvitations).not.toHaveBeenCalled();
    });

    it("shows the form when the invitations cannot be read", async () => {
        listMyOrgInvitations.mockRejectedValue(new Error("down"));
        render(<OnboardingProfilePage />);
        expect(await screen.findByRole("textbox", { name: "Name" })).toBeVisible();
        expect(replace).not.toHaveBeenCalled();
    });

    it("stops waiting for the invitations when the person leaves", async () => {
        const { unmount } = render(<OnboardingProfilePage />);
        unmount();
        expect(replace).not.toHaveBeenCalled();
    });

    it("does not ask a person who joined a firm for an Organization, nor overwrite it", async () => {
        window.localStorage.setItem("mike.activeWorkspace.user-1", "org-1");
        const user = userEvent.setup();
        render(<OnboardingProfilePage />);
        expect(await screen.findByRole("textbox", { name: "Name" })).toBeVisible();
        expect(screen.queryByRole("textbox", { name: /Organi[sz]ation/ })).not.toBeInTheDocument();
        expect(await screen.findByText("Step 1 of 3")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await waitFor(() => expect(updateUserProfile).toHaveBeenCalledWith({ displayName: "Alex" }));
    });

    it("counts two steps when the firm does not take members' own keys", async () => {
        window.localStorage.setItem("mike.activeWorkspace.user-1", "org-1");
        getOrgApiKeys.mockResolvedValue({ effective: {}, allow_personal_keys: { ai: false, web_search: false, scan: false } });
        render(<OnboardingProfilePage />);
        expect(await screen.findByText("Step 1 of 2")).toBeVisible();
    });

    it("reports a failed save and keeps the form", async () => {
        updateUserProfile.mockRejectedValue(new Error("down"));
        const user = userEvent.setup();
        render(<OnboardingProfilePage />);
        await user.click(await screen.findByRole("button", { name: "Continue" }));
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(push).not.toHaveBeenCalled();
    });
});
