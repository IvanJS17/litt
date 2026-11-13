import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetPasswordPage from "./page";

const mocks = vi.hoisted(() => ({
    replace: vi.fn(),
    startInviteSession: vi.fn(),
    updateAuthPassword: vi.fn(),
    getAuthSession: vi.fn(),
    exchangeAuthCode: vi.fn(),
    refreshSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mocks.replace }),
    useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/lib/authApi", () => ({
    startInviteSession: mocks.startInviteSession,
    updateAuthPassword: mocks.updateAuthPassword,
    getAuthSession: mocks.getAuthSession,
    exchangeAuthCode: mocks.exchangeAuthCode,
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ refreshSession: mocks.refreshSession }),
}));
vi.mock("@/app/components/site-logo", () => ({ SiteLogo: () => <div>LiTT</div> }));

describe("SetPasswordPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.startInviteSession.mockResolvedValue({});
        mocks.updateAuthPassword.mockResolvedValue({});
        window.history.replaceState(null, "", "/auth/set-password#access_token=a1&refresh_token=r1&type=invite");
    });

    it("takes the invitation session, saves the password and continues to onboarding", async () => {
        const user = userEvent.setup();
        render(<SetPasswordPage />);

        await user.type(await screen.findByLabelText("Password"), "secret1234");
        await user.type(screen.getByLabelText("Confirm your password"), "secret1234");
        await user.click(screen.getByRole("button", { name: "Save password" }));

        expect(mocks.startInviteSession).toHaveBeenCalledWith("a1", "r1");
        expect(window.location.hash).toBe("");
        expect(mocks.updateAuthPassword).toHaveBeenCalledWith("secret1234");
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/onboarding/invitations"));
    });

    it("says the link is unavailable when there is no usable session", async () => {
        window.history.replaceState(null, "", "/auth/set-password");
        mocks.getAuthSession.mockResolvedValue(null);
        render(<SetPasswordPage />);

        expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
        expect(mocks.updateAuthPassword).not.toHaveBeenCalled();
    });
});
