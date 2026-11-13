"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { SignupLegal } from "@/app/components/legal/SignupLegal";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signup } from "@/app/lib/authApi";
import { useAuthProviders } from "@/app/hooks/useAuthProviders";
import {
    InputUI,
    PasswordInputUI,
    PillButtonUI,
    pillButtonUIClassName,
    authGlassCardUIClassName,
    authInputUIClassName,
    AuthDividerUI,
} from "@mike/ui";
import Link from "next/link";
import { useAuth } from "@/app/contexts/AuthContext";
import { cn } from "@/app/lib/utils";
import { AuthFormError } from "@/app/components/auth/AuthFormError";
import {
    reportFault,
    UserVisibleError,
    describeError,
    supportMailtoFor,
    type UserFacingError,
} from "@/app/lib/userFacingError";


/** A failure the form found itself, so the text is already user-facing. */
function localSignupError(message: string): UserFacingError {
    return describeError(
        new UserVisibleError(message, { kind: "validation" }),
        { action: clientTranslator()("auth.signup.createAction") },
    );
}

/**
 * The shared auth table with this screen's deltas. Anything not listed
 * falls through to `describeError` so a 429, a 5xx, or a dropped connection
 * still says what actually happened.
 */
const SIGNUP_ERROR_MESSAGES = authMessages({
    validation_failed: () => clientTranslator()("auth.signup.checkCredentials"),
    invalid_request: () => clientTranslator()("auth.signup.checkCredentials"),
    over_email_send_rate_limit: () => clientTranslator()("auth.signup.emailRateLimit"),
    request_timeout: () => clientTranslator()("auth.signup.requestTimeout"),
});

/** Classify a signup failure into text a person can act on. */
function describeSignupError(error: unknown): UserFacingError {
    const described = reportFault(error, {
        action: clientTranslator()("auth.signup.createAction"),
        codeMessages: SIGNUP_ERROR_MESSAGES,
        fallback: clientTranslator()("auth.signup.createFailed"),
        operation: "auth.signup",
    });
    return described.kind === "rate_limited"
        ? { ...described, message: authSentenceText("tooManyAttempts") }
        : described;
}
import {
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    isPasswordTooLong,
} from "@/app/components/auth/passwordPolicy";
import { authMessages, authSentenceText } from "@/app/lib/authMessages";
import { clientTranslator } from "@mike/client";
import { GoogleAuthButton } from "@/app/components/auth/GoogleAuthButton";
import { FieldLabel } from "@/app/components/ui/form-field";
import { useTranslations } from "next-intl";

function SignupContent() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { isAuthenticated, authLoading, refreshSession } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<UserFacingError | null>(null);
    const [success, setSuccess] = useState(false);
    const { showGoogle } = useAuthProviders();
    const isAccountCreatedPreview =
        process.env.NODE_ENV !== "production" &&
        searchParams.get("preview") === "account-created";

    useEffect(() => {
        if (isAccountCreatedPreview) return;
        if (!authLoading && isAuthenticated && !loading && !success) {
            router.replace("/onboarding/profile");
        }
    }, [
        authLoading,
        isAccountCreatedPreview,
        isAuthenticated,
        loading,
        router,
        success,
    ]);

    useEffect(() => {
        if (!success) return;
        const timer = setTimeout(() => {
            router.push("/onboarding/profile");
        }, 2000);
        return () => clearTimeout(timer);
    }, [router, success]);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        // Validate passwords match
        if (password !== confirmPassword) {
            setError(localSignupError(t("auth.signup.passwordsDontMatch")));
            setLoading(false);
            return;
        }

        // Validate password length. The upper bound is bcrypt's 72 BYTES:
        // GoTrue rejects anything longer, so say so before the round trip.
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(localSignupError(
                    t("auth.errors.passwordTooShort", {
                        min: MIN_PASSWORD_LENGTH,
                    }),
                ));
            setLoading(false);
            return;
        }
        if (isPasswordTooLong(password)) {
            setError(localSignupError(
                    t("auth.errors.passwordTooLong", { max: MAX_PASSWORD_LENGTH }),
                ));
            setLoading(false);
            return;
        }

        try {
            const trimmedEmail = email.trim();
            const result = await signup(
                trimmedEmail,
                password,
                "/onboarding/profile",
            );

            if (!result.requiresEmailConfirmation) {
                await refreshSession();
                setSuccess(true);
            } else {
                router.push("/signup/check-email");
            }
        } catch (caught: unknown) {
            setError(describeSignupError(caught));
        } finally {
            setLoading(false);
        }
    };

    // Success View
    if (success || isAccountCreatedPreview) {
        return (
            <AuthPageShell>
                <div className="w-full max-w-md">
                    <div className={authGlassCardUIClassName}>
                        <h1 className="font-serif text-2xl font-medium text-gray-950">
                            {t("auth.signup.accountCreated")}
                        </h1>
                        <p className="mt-3 text-sm leading-relaxed text-gray-600">
                            {t("auth.signup.redirecting")}
                        </p>
                        <Link
                            href="/onboarding/profile"
                            className={pillButtonUIClassName({
                                tone: "black",
                                size: "normal",
                                className: "mt-6",
                            })}
                        >
                            {t("auth.signup.continue")}
                        </Link>
                    </div>
                </div>
            </AuthPageShell>
        );
    }

    // Default Signup Form View
    return (
        <AuthPageShell>
            <div className="w-full max-w-md">
                <div className={cn(authGlassCardUIClassName, "mb-4 [@media(max-height:700px)]:mb-1")}>
                    <h2 className="mb-6 text-left text-2xl font-medium font-serif text-gray-950">
                        {t("auth.signup.signUp")}
                    </h2>

                    <form onSubmit={handleSignup} className="space-y-4">
                        <div>
                            <FieldLabel htmlFor="email">
                                {t("auth.signup.email")}
                            </FieldLabel>
                            <InputUI
                                id="email"
                                type="email"
                                autoComplete="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>

                        <div>
                            <FieldLabel htmlFor="password">
                                {t("auth.signup.password")}
                            </FieldLabel>
                            <PasswordInputUI
                                id="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={t("auth.signup.passwordPlaceholder", { min: MIN_PASSWORD_LENGTH })}
                                required
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>

                        <div>
                            <FieldLabel htmlFor="confirmPassword">
                                {t("auth.signup.confirmPassword")}
                            </FieldLabel>
                            <PasswordInputUI
                                id="confirmPassword"
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) =>
                                    setConfirmPassword(e.target.value)
                                }
                                required
                                className={`w-full ${authInputUIClassName}`}
                            />
                        </div>

                        {/* In the card, next to the action that failed: a
                            floating notice would cover the wordmark. */}
                        {error && (
                            <AuthFormError
                                title={error.title}
                                message={error.message}
                                supportHref={
                                    error.supportable
                                        ? supportMailtoFor(
                                              error,
                                              "Failed to create an account.",
                                          )
                                        : undefined
                                }
                                onDismiss={() => setError(null)}
                            />
                        )}

                        <div className="space-y-3 pt-2">
                            {/* LiTT: no terms or privacy notice until LiTT's own texts
                                are approved (being drafted in Kanban t_014f1869); a later
                                card publishes /terminos and /privacidad and links them here.
                                Upstream linked mikeoss.com, another company's documents. */}
                            <PillButtonUI
                                type="submit"
                                tone="black"
                                size="normal"
                                disabled={loading}
                                className="w-full"
                            >
                                {loading ? t("auth.signup.creatingAccount") : t("auth.signup.signUp")}
                            </PillButtonUI>
                            {showGoogle && (
                                <>
                                    <AuthDividerUI label={t("common.or")} />
                                    <GoogleAuthButton
                                        onError={setError}
                                        disabled={loading}
                                        onLoadingChange={setLoading}
                                    />
                                </>
                            )}
                        </div>
                    </form>
                </div>
                <SignupLegal />
                <div className="text-center text-sm text-gray-500">
                    {t("auth.signup.haveAccount")}{" "}
                    <Link
                        href="/login"
                        className="font-medium transition-colors hover:text-gray-950"
                    >
                        {t("auth.signup.logIn")}
                    </Link>
                </div>
            </div>
        </AuthPageShell>
    );
}

export default function SignupPage() {
    return (
        <Suspense fallback={null}>
            <SignupContent />
        </Suspense>
    );
}
