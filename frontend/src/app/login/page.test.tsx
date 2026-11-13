import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadMessages } from "@litt/i18n";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import LoginPage from "./page";
import { AuthApiError } from "@/app/lib/authApi";

const {
    login,
    startGoogleOAuth,
    getAuthProviders,
    refreshSession,
    retrySession,
    authState,
    replace,
    push,
} = vi.hoisted(() => ({
    login: vi.fn(),
    startGoogleOAuth: vi.fn(),
    // Unanswered by default: the page as it looks while the read is in flight.
    getAuthProviders: vi.fn(
        (): Promise<{ sso: boolean; google: boolean | null }> =>
            new Promise(() => {}),
    ),
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
    getAuthProviders,
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

    // Lets the iPhone Keychain / Face ID offer the saved password.
    it("tells the browser which field is the account and which the saved password", () => {
        render(<LoginPage />);

        expect(
            screen.getByRole("textbox", { name: "Email" }),
        ).toHaveAttribute("autocomplete", "username");
        expect(screen.getByLabelText("Password")).toHaveAttribute(
            "autocomplete",
            "current-password",
        );
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

    // The divider is aria-hidden, so it is found by its text.
    const divider = () => screen.queryByText("or", { selector: "span" });

    it("places Google and SSO after the primary login action", async () => {
        getAuthProviders.mockResolvedValueOnce({ sso: true, google: true });
        render(<LoginPage />);

        const login = screen.getByRole("button", { name: "Log in" });
        const google = await screen.findByRole("button", {
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

    it("draws no external route or divider until the server answers, then shows SSO when on", async () => {
        let answer!: (value: { sso: boolean; google: boolean | null }) => void;
        getAuthProviders.mockReturnValueOnce(
            new Promise((resolve) => {
                answer = resolve;
            }),
        );
        render(<LoginPage />);
        expect(
            screen.queryByRole("button", { name: /Continue with/ }),
        ).not.toBeInTheDocument();
        expect(divider()).not.toBeInTheDocument();

        await act(async () => answer({ sso: true, google: true }));
        expect(
            screen.getByRole("button", { name: "Continue with SSO" }),
        ).toBeInTheDocument();
    });

    it("hides Continue with SSO once the server says SSO is off", async () => {
        getAuthProviders.mockResolvedValueOnce({ sso: false, google: true });
        render(<LoginPage />);

        expect(
            await screen.findByRole("button", { name: "Continue with Google" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Continue with SSO" }),
        ).not.toBeInTheDocument();
    });

    it.each([
        ["on", true],
        ["unknown", null],
    ])("keeps Continue with Google when GoTrue's Google is %s", async (_label, google) => {
        getAuthProviders.mockResolvedValueOnce({ sso: true, google });
        render(<LoginPage />);

        await act(async () => {});
        expect(
            screen.getByRole("button", { name: "Continue with Google" }),
        ).toBeInTheDocument();
        expect(divider()).toBeInTheDocument();
    });

    it("hides Continue with Google once the server says Google is off", async () => {
        getAuthProviders.mockResolvedValueOnce({ sso: true, google: false });
        render(<LoginPage />);

        expect(
            await screen.findByRole("button", { name: "Continue with SSO" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Continue with Google" }),
        ).not.toBeInTheDocument();
        expect(divider()).toBeInTheDocument();
    });

    it("drops the divider when no external sign-in route is left", async () => {
        getAuthProviders.mockResolvedValueOnce({ sso: false, google: false });
        render(<LoginPage />);

        await act(async () => {});
        expect(getAuthProviders).toHaveBeenCalled();
        expect(divider()).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: /Continue with/ }),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    });

    it("keeps Continue with SSO when the server can't say whether SSO is on", async () => {
        getAuthProviders.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        render(<LoginPage />);

        await act(async () => {});
        expect(getAuthProviders).toHaveBeenCalled();
        expect(
            screen.getByRole("button", { name: "Continue with SSO" }),
        ).toBeInTheDocument();
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

it("shows a login failure inside the card, not as a floating notice over the wordmark", async () => {
    login.mockRejectedValue(
        new AuthApiError(401, "invalid_credentials", "Invalid credentials"),
    );
    const user = userEvent.setup();
    const { container } = render(<LoginPage />);
    await user.type(
        screen.getByRole("textbox", { name: "Email" }),
        "person@example.com",
    );
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The email or password is incorrect.");
    // Rendered in place, inside the form, before the button that failed.
    expect(container).toContainElement(alert);
    const form = screen.getByRole("button", { name: "Log in" }).closest("form");
    expect(form).toContainElement(alert);
    expect(
        alert.compareDocumentPosition(
            screen.getByRole("button", { name: "Log in" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing portalled to the body and nothing positioned over the page.
    expect(alert.closest(".fixed")).toBeNull();
    expect(document.body.querySelectorAll(":scope > .fixed")).toHaveLength(0);
});

it("shows the session warning in the card and lets it be dismissed", async () => {
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

it("shows a sign-in failure ahead of the session warning", async () => {
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

it("speaks Spanish (es-MX) and offers the language choice", async () => {
    const messages = await loadMessages("es-MX");
    render(
        <IntlClientProvider locale="es-MX" messages={messages}>
            <LoginPage />
        </IntlClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Regístrate" })).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveValue("es-MX");
    expect(screen.queryByText("Forgot password?")).not.toBeInTheDocument();
});
