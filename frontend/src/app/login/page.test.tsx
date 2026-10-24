import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
import { AuthApiError } from "@/app/lib/authApi";

const {
    login,
    startGoogleOAuth,
    refreshSession,
    retrySession,
    authState,
    replace,
    push,
} = vi.hoisted(() => ({
    login: vi.fn(),
    startGoogleOAuth: vi.fn(),
    refreshSession: vi.fn(),
    retrySession: vi.fn(),
    authState: { error: null as string | null },
    replace: vi.fn(),
    push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace, push }),
}));

vi.mock("@/app/lib/authApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/authApi")>()),
    login,
    startGoogleOAuth,
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: false,
        authLoading: false,
        refreshSession,
        retrySession,
        authError: authState.error,
    }),
}));

vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>LiTT</div>,
}));

describe("LoginPage", () => {
    beforeEach(() => {
        authState.error = null;
        retrySession.mockReset();
        login.mockReset();
        startGoogleOAuth.mockReset();
        refreshSession.mockReset();
        refreshSession.mockResolvedValue(null);
        replace.mockReset();
        push.mockReset();
    });

    it("allows an existing account to submit a password shorter than the new minimum", async () => {
        login.mockResolvedValue({ user: { id: "user-1" } });
        const user = userEvent.setup();
        render(<LoginPage />);

        expect(screen.getByLabelText("Password")).not.toHaveAttribute(
            "placeholder",
        );

        await user.type(
            screen.getByRole("textbox", { name: "Email" }),
            "existing@example.com",
        );
        await user.type(screen.getByLabelText("Password"), "oldpass");
        await user.click(screen.getByRole("button", { name: "Log in" }));

        expect(login).toHaveBeenCalledWith("existing@example.com", "oldpass");
        expect(push).toHaveBeenCalledWith("/onboarding/profile");
    });

    it.each([
        [
            "a specific GoTrue code",
            Object.assign(new Error("Invalid login credentials"), {
                status: 400,
                code: "invalid_credentials",
            }),
            "The email or password is incorrect.",
        ],
        [
            "too many attempts",
            Object.assign(new Error("Request rate limit reached"), {
                status: 429,
            }),
            "Too many attempts. Wait a moment and try again.",
        ],
        [
            "a dropped connection",
            new TypeError("Failed to fetch"),
            "LiTT couldn't reach the server. Check your connection and try again.",
        ],
    ])("explains %s instead of a generic line", async (_label, thrown, shown) => {
        login.mockRejectedValue(thrown);
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(
            screen.getByRole("textbox", { name: "Email" }),
            "person@example.com",
        );
        await user.type(screen.getByLabelText("Password"), "correct-horse");
        await user.click(screen.getByRole("button", { name: "Log in" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(shown);
    });

    it("offers Retry for a failure that may pass on a second attempt", async () => {
        login.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        login.mockResolvedValueOnce({ user: { id: "user-1" } });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(
            screen.getByRole("textbox", { name: "Email" }),
            "person@example.com",
        );
        await user.type(screen.getByLabelText("Password"), "correct-horse");
        await user.click(screen.getByRole("button", { name: "Log in" }));

        await user.click(await screen.findByRole("button", { name: "Retry" }));

        expect(login).toHaveBeenCalledTimes(2);
        expect(push).toHaveBeenCalledWith("/onboarding/profile");
    });

    it("places Google and SSO after the primary login action", () => {
        render(<LoginPage />);

        const login = screen.getByRole("button", { name: "Log in" });
        const google = screen.getByRole("button", {
            name: "Continue with Google",
        });
        const sso = screen.getByRole("button", { name: "Continue with SSO" });
        expect(
            login.compareDocumentPosition(google) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
            google.compareDocumentPosition(sso) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});

it("retries a failed session refresh without submitting the empty login form", async () => {
    authState.error = "Unable to check your session.";
    retrySession.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(null);
    render(<LoginPage />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("LiTT couldn't reach the server");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retrySession).toHaveBeenCalledTimes(2);
    expect(login).not.toHaveBeenCalled();
});

it("shows the session warning as a popup that can be dismissed", async () => {
    authState.error = "We could not check your session. Please try again.";
    render(<LoginPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't check your session",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
        "We could not check your session. Please try again.",
    );
    await userEvent.click(
        screen.getByRole("button", { name: "Dismiss warning" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows a sign-in failure in the popup ahead of the session warning", async () => {
    authState.error = "We could not check your session. Please try again.";
    login.mockRejectedValue(
        new AuthApiError(401, "invalid_credentials", "Invalid credentials"),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(
        screen.getByRole("textbox", { name: "Email" }),
        "person@example.com",
    );
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't log in");
    expect(alert).toHaveTextContent("The email or password is incorrect.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    // Dismissing it brings back the warning it was covering.
    await user.click(screen.getByRole("button", { name: "Dismiss warning" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
        "We could not check your session",
    );
});
