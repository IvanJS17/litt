"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { LegalNotice } from "@/app/components/legal/LegalLinks";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/app/lib/authApi";
import { useAuthProviders } from "@/app/hooks/useAuthProviders";
import {
    InputUI,
    PillButtonUI,
    authGlassCardUIClassName,
    authInputUIClassName,
    AuthDividerUI,
} from "@mike/ui";
import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";
import { cn } from "@/app/lib/utils";
import { SsoAuthButton } from "@/app/components/auth/SsoAuthButton";
import { GoogleAuthButton } from "@/app/components/auth/GoogleAuthButton";
import { FieldLabel } from "@/app/components/ui/form-field";
import { AuthFormError } from "@/app/components/auth/AuthFormError";
import {
    reportFault,
    supportMailtoFor,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import {
    AUTH_ERROR_MESSAGES,
    authMessages,
    authSentenceText,
} from "@/app/lib/authMessages";
import { clientTranslator } from "@mike/client";
import { SourceCodeLink } from "@/app/components/shared/SourceCodeLink";
import { useTranslations } from "next-intl";

/**
 * The shared auth table (`@/app/lib/authMessages`) with this screen's
 * deltas. Anything not listed falls through to `describeError`, which
 * classifies by status (429, 5xx) or by the failure itself (offline,
 * connection dropped), so no login failure can collapse into "please try
 * again" without saying what happened.
 */
const LOGIN_ERROR_MESSAGES = authMessages({
    // Same text as invalid_credentials: saying "no such account" would let
    // anyone test which addresses are registered.
    user_not_found: () => AUTH_ERROR_MESSAGES.invalid_credentials,
    // Here the account exists; it is this sign-in route that is closed.
    signup_disabled: () => clientTranslator()("auth.login.signupDisabled"),
    validation_failed: () => clientTranslator()("auth.login.enterCredentials"),
    invalid_request: () => clientTranslator()("auth.login.enterCredentials"),
    request_timeout: () => clientTranslator()("auth.login.requestTimeout"),
});

/** The title `notifyError` gives the same warning away from this page. */
function sessionWarningTitle(): string {
    const t = clientTranslator();
    return t("errors.couldnt", { action: t("auth.login.checkSessionAction") });
}

/** Classify a login failure into text a person can act on. */
function describeLoginError(error: unknown): UserFacingError {
    const described = reportFault(error, {
        action: clientTranslator()("auth.login.logInAction"),
        codeMessages: LOGIN_ERROR_MESSAGES,
        fallback: clientTranslator()("auth.login.logInFailed"),
        operation: "auth.signin",
    });
    // A 429 without a GoTrue code still means "you tried too often".
    return described.kind === "rate_limited"
        ? { ...described, message: authSentenceText("tooManyAttempts") }
        : described;
}

export default function LoginPage() {
    const t = useTranslations();
    const router = useRouter();
    const {
        isAuthenticated,
        authLoading,
        authError,
        refreshSession,
        retrySession,
    } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<UserFacingError | null>(null);
    const [retryingSession, setRetryingSession] = useState(false);
    // The session warning is not about the form: a failed Retry is reported
    // in its place rather than as a sign-in error.
    const [sessionError, setSessionError] = useState<UserFacingError | null>(null);
    const [sessionWarningDismissed, setSessionWarningDismissed] = useState(false);
    const [shownAuthError, setShownAuthError] = useState(authError);
    if (shownAuthError !== authError) {
        // A new failure is a new warning, even after the last was dismissed.
        setShownAuthError(authError);
        setSessionError(null);
        setSessionWarningDismissed(false);
    }

    const { showSso, showGoogle } = useAuthProviders();

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/onboarding/profile");
        }
    }, [authLoading, isAuthenticated, router]);

    const submitLogin = async () => {
        setLoading(true);
        setError(null);
        try {
            await login(email, password);
            await refreshSession();
            router.push("/onboarding/profile");
        } catch (caught: unknown) {
            setError(describeLoginError(caught));
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        await submitLogin();
    };

    const handleRetrySession = async () => {
        setRetryingSession(true);
        setSessionError(null);
        try {
            await retrySession();
        } catch (caught: unknown) {
            // The Retry button failing silently is what made the original
            // session error look permanent; say so instead.
            setSessionError(
                reportFault(caught, {
                    action: t("auth.login.restoreAction"),
                    fallback: t("auth.login.restoreFailed"),
                    operation: "auth.session",
                }),
            );
            setSessionWarningDismissed(false);
        } finally {
            setRetryingSession(false);
        }
    };

    // One warning at a time: the form's own failure first, then the session's.
    const sessionWarningOpen =
        !error && !!authError && !sessionWarningDismissed;
    const shownError = error ?? (sessionWarningOpen ? sessionError : null);
    const retryAction = error
        ? error.retryable
            ? {
                  label: t("auth.login.retry"),
                  onClick: () => void submitLogin(),
                  disabled: loading,
              }
            : undefined
        : sessionWarningOpen
          ? {
                label: retryingSession ? t("auth.login.retrying") : t("auth.login.retry"),
                onClick: () => void handleRetrySession(),
                disabled: retryingSession,
            }
          : undefined;

    return (
        <AuthPageShell>
            <div className="w-full max-w-md">
                {/* Login Form */}
                <div className={cn(authGlassCardUIClassName, "mb-4 [@media(max-height:700px)]:mb-1")}>
                    <h2 className="mb-6 text-left text-2xl font-medium font-serif text-gray-950">
                        {t("auth.login.logIn")}
                    </h2>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <FieldLabel htmlFor="email">{t("auth.login.email")}</FieldLabel>
                            <InputUI
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>

                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <FieldLabel htmlFor="password">
                                    {t("auth.login.password")}
                                </FieldLabel>
                                <Link
                                    href="/forgot-password"
                                    className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-950"
                                >
                                    {t("auth.login.forgotPassword")}
                                </Link>
                            </div>
                            <InputUI
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>

                        {/* In the card, next to the action that failed: a
                            floating notice would cover the wordmark. */}
                        {(error || sessionWarningOpen) && (
                            <AuthFormError
                                title={
                                    shownError
                                        ? shownError.title
                                        : sessionWarningTitle()
                                }
                                message={
                                    shownError ? shownError.message : authError
                                }
                                retry={retryAction}
                                supportHref={
                                    shownError?.supportable
                                        ? supportMailtoFor(
                                              shownError,
                                              "Failed to log in.",
                                          )
                                        : undefined
                                }
                                onDismiss={() => {
                                    if (error) setError(null);
                                    else setSessionWarningDismissed(true);
                                }}
                            />
                        )}

                        <div className="pt-2">
                            <PillButtonUI
                                type="submit"
                                tone="black"
                                size="normal"
                                disabled={loading}
                                className="w-full"
                            >
                                {loading ? t("auth.login.loggingIn") : t("auth.login.logIn")}
                            </PillButtonUI>
                        </div>
                        {(showGoogle || showSso) && <AuthDividerUI label={t("common.or")} />}
                        {showGoogle && (
                            <GoogleAuthButton
                                onError={(nextError) => setError(nextError)}
                                disabled={loading}
                                onLoadingChange={setLoading}
                            />
                        )}
                        {showSso && <SsoAuthButton disabled={loading} />}
                    </form>
                </div>
                <LegalNotice />
                <div className="text-center text-sm text-gray-500">
                    {t("auth.login.noAccount")}{" "}
                    <Link
                        href="/signup"
                        className="font-medium transition-colors hover:text-gray-950"
                    >
                        {t("auth.login.signUp")}
                    </Link>
                </div>
                <footer className="mt-6 flex justify-center">
                    <SourceCodeLink />
                </footer>
            </div>
        </AuthPageShell>
    );
}
