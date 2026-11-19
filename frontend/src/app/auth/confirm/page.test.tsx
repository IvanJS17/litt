import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthConfirmPage from "./page";

const { verifyEmailLinkToken, refreshSession, router, state } = vi.hoisted(
    () => ({
        verifyEmailLinkToken: vi.fn(),
        refreshSession: vi.fn(),
        router: { replace: vi.fn() },
        state: { params: new URLSearchParams() },
    }),
);

vi.mock("next/navigation", () => ({
    useRouter: () => router,
    useSearchParams: () => state.params,
}));
vi.mock("@/app/lib/authApi", () => ({ verifyEmailLinkToken }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ refreshSession }),
}));
vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>LiTT</div>,
}));

const TYPES = [
    {
        type: "recovery",
        next: "/reset-password",
        title: "Continue to create your new password",
        button: "Continue",
    },
    {
        type: "signup",
        next: "/onboarding/profile",
        title: "Confirm your email",
        button: "Confirm my email",
    },
    {
        type: "email_change",
        next: "/settings?emailChange=processed",
        title: "Confirm your email change",
        button: "Confirm email change",
    },
] as const;

describe("AuthConfirmPage per link type", () => {
    beforeEach(() => {
        verifyEmailLinkToken.mockReset();
        refreshSession.mockReset().mockResolvedValue(null);
        router.replace.mockReset();
    });

    it.each(TYPES)(
        "$type: shows its own copy, spends nothing on load, verifies on click and redirects",
        async ({ type, next, title, button }) => {
            state.params = new URLSearchParams({
                token_hash: "abc123",
                type,
                next,
            });
            verifyEmailLinkToken.mockResolvedValue({ user: { id: "u1" } });
            render(<AuthConfirmPage />);

            expect(
                screen.getByRole("heading", { name: title }),
            ).toBeInTheDocument();
            expect(verifyEmailLinkToken).not.toHaveBeenCalled();

            await userEvent.click(screen.getByRole("button", { name: button }));

            await waitFor(() =>
                expect(router.replace).toHaveBeenCalledWith(next),
            );
            expect(verifyEmailLinkToken).toHaveBeenCalledExactlyOnceWith(
                "abc123",
                type,
            );
            expect(refreshSession).toHaveBeenCalled();
        },
    );

    it("does not follow an unsafe next", async () => {
        state.params = new URLSearchParams({
            token_hash: "abc123",
            type: "signup",
            next: "https://evil.example/",
        });
        verifyEmailLinkToken.mockResolvedValue({ user: { id: "u1" } });
        render(<AuthConfirmPage />);

        await userEvent.click(
            screen.getByRole("button", { name: "Confirm my email" }),
        );

        await waitFor(() =>
            expect(router.replace).toHaveBeenCalledWith("/assistant"),
        );
    });

    it("tells the person to confirm the other link when only the first of two email-change links was confirmed", async () => {
        state.params = new URLSearchParams(
            "token_hash=abc123&type=email_change&next=/settings%3FemailChange%3Dprocessed",
        );
        verifyEmailLinkToken.mockResolvedValue({
            user: null,
            pendingSecondConfirmation: true,
        });
        render(<AuthConfirmPage />);

        await userEvent.click(
            screen.getByRole("button", { name: "Confirm email change" }),
        );

        expect(
            await screen.findByRole("heading", { name: "One link left" }),
        ).toBeInTheDocument();
        expect(router.replace).not.toHaveBeenCalled();
        expect(refreshSession).not.toHaveBeenCalled();
    });

    it("treats an unknown type as a spent link, with no request", async () => {
        state.params = new URLSearchParams("token_hash=abc123&type=invite");
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button"));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "This confirmation link is invalid or has expired. Request a new one.",
        );
        expect(verifyEmailLinkToken).not.toHaveBeenCalled();
    });
});

describe("AuthConfirmPage", () => {
    beforeEach(() => {
        verifyEmailLinkToken.mockReset();
        refreshSession.mockReset().mockResolvedValue(null);
        router.replace.mockReset();
        state.params = new URLSearchParams(
            "token_hash=abc123&type=recovery&next=/reset-password",
        );
    });

    it("spends nothing until the button is pressed", () => {
        render(<AuthConfirmPage />);

        expect(
            screen.getByRole("button", { name: "Continue" }),
        ).toBeEnabled();
        expect(verifyEmailLinkToken).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
    });

    it("verifies the token on click and goes to the reset screen", async () => {
        verifyEmailLinkToken.mockResolvedValue({ user: { id: "u1" } });
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        await waitFor(() =>
            expect(router.replace).toHaveBeenCalledWith("/reset-password"),
        );
        expect(verifyEmailLinkToken).toHaveBeenCalledExactlyOnceWith("abc123", "recovery");
        expect(refreshSession).toHaveBeenCalled();
    });

    it("calls a spent link spent", async () => {
        verifyEmailLinkToken.mockRejectedValue(
            Object.assign(new Error("Email link is invalid or has expired"), {
                status: 401,
                code: "otp_expired",
            }),
        );
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "This confirmation link is invalid or has expired. Request a new one.",
        );
        expect(router.replace).not.toHaveBeenCalled();
    });

    it("says the session could not start, not that the link is spent, when the token was verified but the session check fails", async () => {
        verifyEmailLinkToken.mockResolvedValue({ user: { id: "u1" } });
        refreshSession.mockRejectedValue(new Error("network down"));
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Your link was confirmed, but we couldn't start your session. Log in to continue.",
        );
        expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /log ?in/i })).toHaveAttribute("href", "/login");
        expect(router.replace).not.toHaveBeenCalled();
    });

    it("reports a link without a token as spent, with no request", async () => {
        state.params = new URLSearchParams("type=recovery");
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "This confirmation link is invalid or has expired. Request a new one.",
        );
        expect(verifyEmailLinkToken).not.toHaveBeenCalled();
    });
});
