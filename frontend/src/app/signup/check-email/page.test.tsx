import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SignupCheckEmailPage from "./page";

const { replace, useAuth, state } = vi.hoisted(() => ({
    replace: vi.fn(),
    useAuth: vi.fn(),
    state: { params: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace }),
    useSearchParams: () => state.params,
}));

vi.mock("@/app/contexts/AuthContext", () => ({ useAuth }));

vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>Mike</div>,
}));

describe("SignupCheckEmailPage", () => {
    beforeEach(() => {
        replace.mockReset();
        state.params = new URLSearchParams();
        useAuth.mockReturnValue({
            isAuthenticated: false,
            authLoading: false,
        });
    });

    it("shows the confirmation instructions on a dedicated route", () => {
        render(<SignupCheckEmailPage />);

        expect(
            screen.getByRole("heading", { name: "Check your email" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Return to login" }),
        ).toHaveAttribute("href", "/login");
    });

    it("tells nobody an invitation exists when sign-up is by invitation only", () => {
        state.params = new URLSearchParams("mode=invitation");
        render(<SignupCheckEmailPage />);

        expect(
            screen.getByText(
                "If this address has an invitation, we sent a link to it. Open it to choose your password.",
            ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/confirm your address/)).not.toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "Return to login" }),
        ).toHaveAttribute("href", "/login");
    });

    it("keeps the confirmation text of open sign-up", () => {
        state.params = new URLSearchParams("mode=other");
        render(<SignupCheckEmailPage />);

        expect(screen.getByText(/Open it to confirm your address/)).toBeInTheDocument();
    });

    it("redirects authenticated users to onboarding", async () => {
        useAuth.mockReturnValue({
            isAuthenticated: true,
            authLoading: false,
        });

        render(<SignupCheckEmailPage />);

        await waitFor(() => {
            expect(replace).toHaveBeenCalledWith("/onboarding/profile");
        });
        expect(
            screen.queryByRole("heading", { name: "Check your email" }),
        ).not.toBeInTheDocument();
    });
});
