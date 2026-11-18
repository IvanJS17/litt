import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthConfirmPage from "./page";

const { verifyRecoveryToken, refreshSession, router, state } = vi.hoisted(
    () => ({
        verifyRecoveryToken: vi.fn(),
        refreshSession: vi.fn(),
        router: { replace: vi.fn() },
        state: { params: new URLSearchParams() },
    }),
);

vi.mock("next/navigation", () => ({
    useRouter: () => router,
    useSearchParams: () => state.params,
}));
vi.mock("@/app/lib/authApi", () => ({ verifyRecoveryToken }));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ refreshSession }),
}));
vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>LiTT</div>,
}));

describe("AuthConfirmPage", () => {
    beforeEach(() => {
        verifyRecoveryToken.mockReset();
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
        expect(verifyRecoveryToken).not.toHaveBeenCalled();
        expect(router.replace).not.toHaveBeenCalled();
    });

    it("verifies the token on click and goes to the reset screen", async () => {
        verifyRecoveryToken.mockResolvedValue({ user: { id: "u1" } });
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        await waitFor(() =>
            expect(router.replace).toHaveBeenCalledWith("/reset-password"),
        );
        expect(verifyRecoveryToken).toHaveBeenCalledExactlyOnceWith("abc123");
        expect(refreshSession).toHaveBeenCalled();
    });

    it("calls a spent link spent", async () => {
        verifyRecoveryToken.mockRejectedValue(
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

    it("reports a link without a token as spent, with no request", async () => {
        state.params = new URLSearchParams("type=recovery");
        render(<AuthConfirmPage />);

        await userEvent.click(screen.getByRole("button", { name: "Continue" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "This confirmation link is invalid or has expired. Request a new one.",
        );
        expect(verifyRecoveryToken).not.toHaveBeenCalled();
    });
});
