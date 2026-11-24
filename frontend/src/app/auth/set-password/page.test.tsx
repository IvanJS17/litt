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
    logout: vi.fn(),
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
    logout: mocks.logout,
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ refreshSession: mocks.refreshSession }),
}));
vi.mock("@/app/components/site-logo", () => ({ SiteLogo: () => <div>LiTT</div> }));

const linkToken = (claims: Record<string, unknown> = { email: "invited@example.test" }) =>
    `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
const openLink = (accessToken = linkToken()) =>
    window.history.replaceState(
        null,
        "",
        `/auth/set-password#access_token=${accessToken}&refresh_token=r1&type=invite`,
    );

describe("SetPasswordPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.startInviteSession.mockResolvedValue({});
        mocks.updateAuthPassword.mockResolvedValue({});
        mocks.logout.mockResolvedValue(undefined);
        mocks.getAuthSession.mockResolvedValue(null);
        openLink();
    });

    it("takes the invitation session, saves the password and continues to onboarding", async () => {
        const user = userEvent.setup();
        render(<SetPasswordPage />);

        await user.click(await screen.findByRole("button", { name: "Continue" }));
        await user.type(await screen.findByLabelText("Password"), "secret1234");
        await user.type(screen.getByLabelText("Confirm your password"), "secret1234");
        await user.click(screen.getByRole("button", { name: "Save password" }));

        expect(mocks.startInviteSession).toHaveBeenCalledWith(linkToken(), "r1");
        expect(mocks.logout).not.toHaveBeenCalled();
        expect(window.location.hash).toBe("");
        expect(mocks.updateAuthPassword).toHaveBeenCalledWith("secret1234");
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/onboarding/invitations"));
    });

    it("keeps the button live and says what is missing when a field is empty", async () => {
        const user = userEvent.setup();
        render(<SetPasswordPage />);

        await user.click(await screen.findByRole("button", { name: "Continue" }));
        const save = await screen.findByRole("button", { name: "Save password" });
        expect(save).toBeEnabled();
        await user.click(save);
        expect(await screen.findByRole("alert")).toHaveTextContent("Enter the password in both fields.");
        expect(mocks.updateAuthPassword).not.toHaveBeenCalled();

        await user.type(screen.getByLabelText("Password"), "secret1234");
        await user.click(save);
        expect(await screen.findByRole("alert")).toHaveTextContent("Enter the password in both fields.");
        expect(screen.getByLabelText("Confirm your password")).toHaveFocus();
        expect(mocks.updateAuthPassword).not.toHaveBeenCalled();
    });

    it("says the link is unavailable when there is no usable session", async () => {
        window.history.replaceState(null, "", "/auth/set-password");
        mocks.getAuthSession.mockResolvedValue(null);
        render(<SetPasswordPage />);

        expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
        expect(mocks.updateAuthPassword).not.toHaveBeenCalled();
    });

    it("adopts nothing until the person confirms, and says whose invitation it is", async () => {
        render(<SetPasswordPage />);

        expect(await screen.findByText("Accept your invitation")).toBeInTheDocument();
        expect(screen.getByText(/invited@example\.test/)).toBeInTheDocument();
        expect(mocks.startInviteSession).not.toHaveBeenCalled();
        expect(mocks.refreshSession).not.toHaveBeenCalled();
        expect(window.location.hash).toBe("");
    });

    it("treats a session of the invited account as no conflict", async () => {
        mocks.getAuthSession.mockResolvedValue({ id: "u1", email: "Invited@Example.test" });
        const user = userEvent.setup();
        render(<SetPasswordPage />);

        await user.click(await screen.findByRole("button", { name: "Continue" }));

        await waitFor(() => expect(mocks.startInviteSession).toHaveBeenCalledTimes(1));
        expect(mocks.logout).not.toHaveBeenCalled();
    });

    describe("when another account is already signed in", () => {
        beforeEach(() => mocks.getAuthSession.mockResolvedValue({ id: "u2", email: "other@example.test" }));

        it("says so and keeps that session until the person chooses", async () => {
            render(<SetPasswordPage />);

            expect(await screen.findByText("You are signed in as another account")).toBeInTheDocument();
            expect(screen.getByText(/other@example\.test/)).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
            expect(mocks.startInviteSession).not.toHaveBeenCalled();
            expect(mocks.logout).not.toHaveBeenCalled();
        });

        it("leaves the invitation alone when the person stays signed in", async () => {
            const user = userEvent.setup();
            render(<SetPasswordPage />);

            await user.click(await screen.findByRole("button", { name: "Stay signed in" }));

            expect(mocks.replace).toHaveBeenCalledWith("/assistant");
            expect(mocks.startInviteSession).not.toHaveBeenCalled();
            expect(mocks.logout).not.toHaveBeenCalled();
        });

        it("signs the other account out first when the person continues as the invited address", async () => {
            const user = userEvent.setup();
            render(<SetPasswordPage />);

            await user.click(await screen.findByRole("button", { name: "Continue as invited@example.test" }));

            await waitFor(() => expect(mocks.startInviteSession).toHaveBeenCalledTimes(1));
            expect(mocks.logout.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.startInviteSession.mock.invocationCallOrder[0],
            );
            expect(await screen.findByLabelText("Password")).toBeInTheDocument();
        });

        it("keeps the other session when the sign-out fails", async () => {
            mocks.logout.mockRejectedValue(new Error("down"));
            const user = userEvent.setup();
            render(<SetPasswordPage />);

            await user.click(await screen.findByRole("button", { name: "Continue as invited@example.test" }));

            expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
            expect(mocks.startInviteSession).not.toHaveBeenCalled();
        });
    });

    it("says the link is unavailable when the server refuses the session", async () => {
        mocks.startInviteSession.mockRejectedValue(new Error("refused"));
        const user = userEvent.setup();
        render(<SetPasswordPage />);

        await user.click(await screen.findByRole("button", { name: "Continue" }));

        expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
    });

    it("shows the checking state while the continue request is pending", async () => {
        mocks.startInviteSession.mockReturnValue(new Promise(() => {}));
        const user = userEvent.setup();
        render(<SetPasswordPage />);

        await user.click(await screen.findByRole("button", { name: "Continue" }));

        expect(await screen.findByRole("button", { name: "Checking your invitation..." })).toBeDisabled();
    });

    it.each([
        ["no usable address", () => openLink(linkToken({}))],
        ["a token that is not readable", () => openLink("not-a-token")],
    ])("treats %s in the link as unavailable without asking the server", async (_name, arrange) => {
        arrange();
        render(<SetPasswordPage />);

        expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
        expect(mocks.startInviteSession).not.toHaveBeenCalled();
    });

    it("treats a session lookup that fails as unavailable and posts nothing", async () => {
        mocks.getAuthSession.mockRejectedValue(new Error("down"));
        render(<SetPasswordPage />);

        expect(await screen.findByText("Invitation unavailable")).toBeInTheDocument();
        expect(mocks.startInviteSession).not.toHaveBeenCalled();
    });
});
