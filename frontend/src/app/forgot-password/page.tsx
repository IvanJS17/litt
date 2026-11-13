"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { useState } from "react";
import Link from "next/link";
import {
    InputUI,
    PillButtonUI,
    pillButtonUIClassName,
    authGlassCardUIClassName,
    authInputUIClassName,
} from "@mike/ui";
import { requestPasswordReset } from "@/app/lib/authApi";
import { FieldLabel } from "@/app/components/ui/form-field";
import {
    describeError,
    supportMailtoFor,
    type UserErrorKind,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";

/**
 * Failures that mean the request never reached Mike. Telling the user to
 * check their email after one of these would be a lie, and none of them
 * depends on whether the address exists, so saying so leaks nothing.
 */
const DELIVERY_FAILURE_KINDS: ReadonlySet<UserErrorKind> = new Set([
    "offline",
    "network",
    "timeout",
    "unavailable",
    "server",
    // The 10-per-hour reset limiter and a blocked request both answer before
    // any address is looked at, so neither says whether the account exists.
    // Showing "check your email" for them would promise mail nobody sent.
    "rate_limited",
    "forbidden",
]);

export default function ForgotPasswordPage() {
    const t = useTranslations();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<UserFacingError | null>(null);

    async function sendResetLink() {
        setLoading(true);
        setError(null);
        try {
            await requestPasswordReset(email.trim());
            setSubmitted(true);
        } catch (caught) {
            const described = describeError(caught, {
                action: t("auth.forgotPassword.sendAction"),
                fallback: t("auth.forgotPassword.sendFailed"),
            });
            if (DELIVERY_FAILURE_KINDS.has(described.kind)) {
                setError(described);
                return;
            }
            // Every other outcome gets the same response for existing and
            // unknown addresses, so this screen cannot be used to enumerate
            // Mike accounts.
            setSubmitted(true);
        } finally {
            setLoading(false);
        }
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        await sendResetLink();
    }

    return (
        <AuthPageShell>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    {submitted ? (
                        <div>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.forgotPassword.checkYourEmail")}
                            </h1>
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">
                                {t("auth.forgotPassword.ifAnAccountExistsFor")} {email.trim()}{t("auth.forgotPassword.weSentAPasswordResetLink")}
                            </p>
                            <Link
                                href="/login"
                                className={pillButtonUIClassName({
                                    tone: "black",
                                    size: "normal",
                                    className: "mt-6",
                                })}
                            >
                                {t("auth.forgotPassword.returnToLogin")}
                            </Link>
                        </div>
                    ) : (
                        <>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.forgotPassword.resetYourPassword")}
                            </h1>
                            <p className="mt-2 text-sm leading-relaxed text-gray-500">
                                {t("auth.forgotPassword.enterYourAccountEmailAndWe")}
                            </p>
                            <form
                                onSubmit={handleSubmit}
                                className="mt-6 space-y-4"
                            >
                                <div>
                                    <FieldLabel htmlFor="email">
                                        {t("auth.forgotPassword.email")}
                                    </FieldLabel>
                                    <InputUI
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(event) =>
                                            setEmail(event.target.value)
                                        }
                                        required
                                        className={`w-full ${authInputUIClassName}`}
                                    />
                                </div>
                                {error && (
                                    <div
                                        role="alert"
                                        className="rounded bg-red-50 p-3 text-sm text-red-600"
                                    >
                                        {error.message}
                                        {error.retryable && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    void sendResetLink()
                                                }
                                                disabled={loading}
                                                className="ml-2 underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                                            >
                                                {t("auth.forgotPassword.retry")}
                                            </button>
                                        )}
                                        {error.supportable && (
                                            <a
                                                href={supportMailtoFor(
                                                    error,
                                                    "Failed to request a password reset.",
                                                )}
                                                className="ml-2 underline underline-offset-2"
                                            >
                                                {t("auth.forgotPassword.contactSupport")}
                                            </a>
                                        )}
                                    </div>
                                )}
                                <PillButtonUI
                                    type="submit"
                                    tone="black"
                                    size="normal"
                                    disabled={loading || !email.trim()}
                                    className="w-full"
                                >
                                    {loading
                                        ? t("auth.forgotPassword.sendingResetLink")
                                        : t("auth.forgotPassword.sendResetLink")}
                                </PillButtonUI>
                            </form>
                            <div className="mt-5 text-center">
                                <Link
                                    href="/login"
                                    className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-950"
                                >
                                    {t("auth.forgotPassword.returnToLogin")}
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </AuthPageShell>
    );
}
