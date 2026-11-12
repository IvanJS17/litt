"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
    InputUI,
    PillButtonUI,
    pillButtonUIClassName,
    authGlassCardUIClassName,
    authInputUIClassName,
} from "@mike/ui";
import {
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    isPasswordTooLong,
} from "@/app/components/auth/passwordPolicy";
import { authMessages, authSentence } from "@/app/lib/authMessages";
import { clientTranslator } from "@mike/client";
import { getAuthSession, updateAuthPassword } from "@/app/lib/authApi";
import { FieldLabel } from "@/app/components/ui/form-field";
import {
    describeError,
    supportMailtoFor,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";

/** The shared auth table with this screen's deltas: here every session-
 *  shaped failure is really "your reset link is no longer usable". */
const RESET_ERROR_MESSAGES = authMessages({
    validation_failed: authSentence("passwordLength"),
    invalid_request: authSentence("passwordLength"),
    otp_expired: () => clientTranslator()("auth.resetPassword.linkExpired"),
    session_expired: () => clientTranslator()("auth.resetPassword.linkExpired"),
    session_not_found: () => clientTranslator()("auth.resetPassword.linkInvalidRequestNew"),
    cookie_session_required: () => clientTranslator()("auth.resetPassword.linkInvalidRequestNew"),
    reauthentication_needed: () => clientTranslator()("auth.resetPassword.reauthenticate"),
});

function ResetPasswordContent() {
    const t = useTranslations();
    const searchParams = useSearchParams();
    const [ready, setReady] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [failure, setFailure] = useState<UserFacingError | null>(null);
    const preview =
        process.env.NODE_ENV !== "production"
            ? searchParams.get("preview")
            : null;
    const isVerifyingPreview = preview === "reset-verifying";
    const isUnavailablePreview = preview === "reset-unavailable";
    const displayedReady = isUnavailablePreview || ready;
    const displayedError = isUnavailablePreview
        ? t("auth.resetPassword.thisPasswordResetLinkIsInvalid")
        : error;
    const resetUnavailable =
        displayedReady && !!displayedError && !password && !confirmPassword;
    const verticallyCentered = !displayedReady || success || resetUnavailable;

    useEffect(() => {
        if (isVerifyingPreview || isUnavailablePreview) return;

        let cancelled = false;
        void getAuthSession()
            .then((session) => {
                if (cancelled) return;
                if (!session) {
                    setError(
                        t("auth.resetPassword.thisPasswordResetLinkIsInvalid"),
                    );
                }
                setReady(true);
            })
            .catch((caught: unknown) => {
                if (cancelled) return;
                // A 401 means the link is spent; a dropped connection does
                // not, and telling the user to request a new link then would
                // send them round a loop that cannot work.
                const described = describeError(caught, {
                    action: t("auth.resetPassword.checkLinkAction"),
                    fallback: t("auth.resetPassword.thisPasswordResetLinkIsInvalid"),
                });
                setError(
                    described.kind === "unauthenticated" ||
                        described.kind === "not_found" ||
                        described.kind === "validation"
                        ? t("auth.resetPassword.thisPasswordResetLinkIsInvalid")
                        : described.message,
                );
                setReady(true);
            });
        return () => {
            cancelled = true;
        };
    }, [isUnavailablePreview, isVerifyingPreview, t]);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setFailure(null);
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(
                t("auth.errors.passwordTooShort", {
                    min: MIN_PASSWORD_LENGTH,
                }),
            );
            return;
        }
        if (isPasswordTooLong(password)) {
            setError(
                t("auth.errors.passwordTooLong", { max: MAX_PASSWORD_LENGTH }),
            );
            return;
        }
        if (password !== confirmPassword) {
            setError(t("auth.resetPassword.passwordsDoNotMatch"));
            return;
        }

        setLoading(true);
        try {
            await updateAuthPassword(password, true);
            setSuccess(true);
        } catch (caught) {
            const described = describeError(caught, {
                action: t("auth.resetPassword.updateAction"),
                codeMessages: RESET_ERROR_MESSAGES,
                fallback: t("auth.resetPassword.updateFailed"),
            });
            setFailure(described);
            setError(described.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthPageShell align={verticallyCentered ? "center" : "top"}>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    {!displayedReady ? (
                        <div>
                            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                            <h1 className="mt-4 font-serif text-2xl font-medium text-gray-950">
                                {t("auth.resetPassword.verifyingYourResetLink")}
                            </h1>
                            <p className="mt-2 text-sm text-gray-500">
                                {t("auth.resetPassword.thisShouldOnlyTakeAMoment")}
                            </p>
                        </div>
                    ) : success ? (
                        <div>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.resetPassword.passwordUpdated")}
                            </h1>
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">
                                {t("auth.resetPassword.yourPasswordHasBeenChangedLog")}
                            </p>
                            <Link
                                href="/login"
                                className={pillButtonUIClassName({
                                    tone: "black",
                                    size: "normal",
                                    className: "mt-6",
                                })}
                            >
                                {t("auth.resetPassword.logIn")}
                            </Link>
                        </div>
                    ) : resetUnavailable ? (
                        <div>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.resetPassword.resetLinkUnavailable")}
                            </h1>
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">
                                {displayedError}
                            </p>
                            <Link
                                href="/forgot-password"
                                className={pillButtonUIClassName({
                                    tone: "black",
                                    size: "normal",
                                    className: "mt-6",
                                })}
                            >
                                {t("auth.resetPassword.requestAnotherLink")}
                            </Link>
                        </div>
                    ) : (
                        <>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.resetPassword.chooseANewPassword")}
                            </h1>
                            <p className="mt-2 text-sm text-gray-500">
                                {t("auth.resetPassword.useAtLeastMinPasswordLength", { MIN_PASSWORD_LENGTH })}
                            </p>
                            <form
                                onSubmit={handleSubmit}
                                className="mt-6 space-y-4"
                            >
                                <div>
                                    <FieldLabel htmlFor="password">
                                        {t("auth.resetPassword.newPassword")}
                                    </FieldLabel>
                                    <InputUI
                                        id="password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(event) =>
                                            setPassword(event.target.value)
                                        }
                                        required
                                        className={`w-full ${authInputUIClassName}`}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor="confirmPassword">
                                        {t("auth.resetPassword.confirmNewPassword")}
                                    </FieldLabel>
                                    <InputUI
                                        id="confirmPassword"
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmPassword}
                                        onChange={(event) =>
                                            setConfirmPassword(
                                                event.target.value,
                                            )
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
                                        {error}
                                        {failure?.supportable && (
                                            <a
                                                href={supportMailtoFor(
                                                    failure,
                                                    "Failed to update a password from a reset link.",
                                                )}
                                                className="ml-2 underline underline-offset-2"
                                            >
                                                {t("auth.resetPassword.contactSupport")}
                                            </a>
                                        )}
                                    </div>
                                )}
                                <PillButtonUI
                                    type="submit"
                                    tone="black"
                                    size="normal"
                                    disabled={
                                        loading || !password || !confirmPassword
                                    }
                                    className="w-full"
                                >
                                    {loading
                                        ? t("auth.resetPassword.updatingPassword")
                                        : t("auth.resetPassword.updatePassword")}
                                </PillButtonUI>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </AuthPageShell>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={null}>
            <ResetPasswordContent />
        </Suspense>
    );
}
