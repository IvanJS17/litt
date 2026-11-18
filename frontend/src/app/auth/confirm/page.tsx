"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
    PillButtonUI,
    pillButtonUIClassName,
    authGlassCardUIClassName,
} from "@mike/ui";
import { safeAuthNext } from "@/app/lib/authRedirects";
import { verifyRecoveryToken } from "@/app/lib/authApi";
import { useAuth } from "@/app/contexts/AuthContext";
import {
    UserVisibleError,
    describeError,
    reportFault,
    supportMailtoFor,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import {
    authMessages,
    authSentence,
    authSentenceText,
} from "@/app/lib/authMessages";
import { useTranslations } from "next-intl";

/** Every spent or expired one-time token is the same spent link. */
const CONFIRM_ERROR_MESSAGES = authMessages({
    otp_expired: authSentence("linkSpent"),
});

/**
 * The email link is only a door: the token is spent when the person presses
 * the button, never on load, because mail scanners open links before the
 * person does and would use up the one-time token.
 */
function AuthConfirmContent() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { refreshSession } = useAuth();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<UserFacingError | null>(null);
    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type");
    const linkIsUsable = !!tokenHash && type === "recovery";

    async function handleContinue() {
        if (busy) return;
        const action = t("auth.confirm.action");
        if (!linkIsUsable) {
            setError(
                describeError(
                    new UserVisibleError(authSentenceText("linkSpent"), {
                        kind: "validation",
                    }),
                    { action },
                ),
            );
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await verifyRecoveryToken(tokenHash);
            await refreshSession();
        } catch (caught) {
            const described = reportFault(caught, {
                action,
                codeMessages: CONFIRM_ERROR_MESSAGES,
                fallback: authSentenceText("linkSpent"),
                operation: "auth.session",
            });
            const spent =
                described.status !== null &&
                described.status >= 400 &&
                described.status < 500 &&
                described.kind !== "rate_limited";
            setError(
                spent && !described.code
                    ? { ...described, message: authSentenceText("linkSpent") }
                    : described,
            );
            setBusy(false);
            return;
        }
        router.replace(safeAuthNext(searchParams.get("next")));
    }

    return (
        <AuthPageShell>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    {error ? (
                        <>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.callback.unableToConfirm")}
                            </h1>
                            <p
                                role="alert"
                                className="mt-3 text-sm leading-relaxed text-gray-600"
                            >
                                {error.message}
                            </p>
                            {error.supportable && (
                                <p className="mt-3 text-sm text-gray-500">
                                    <a
                                        href={supportMailtoFor(
                                            error,
                                            "Failed to verify an emailed link.",
                                        )}
                                        className="font-medium underline underline-offset-2"
                                    >
                                        {t("auth.callback.contactSupport")}
                                    </a>
                                </p>
                            )}
                            <Link
                                href="/login"
                                className={pillButtonUIClassName({
                                    tone: "black",
                                    size: "normal",
                                    className: "mt-6",
                                })}
                            >
                                {t("auth.callback.returnToLogin")}
                            </Link>
                        </>
                    ) : (
                        <>
                            <h1 className="text-2xl font-medium font-serif text-gray-950">
                                {t("auth.confirm.title")}
                            </h1>
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">
                                {t("auth.confirm.description")}
                            </p>
                            <PillButtonUI
                                type="button"
                                tone="black"
                                size="normal"
                                className="mt-6"
                                disabled={busy}
                                onClick={() => void handleContinue()}
                            >
                                {busy ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        {t("auth.confirm.verifying")}
                                    </>
                                ) : (
                                    t("auth.confirm.continue")
                                )}
                            </PillButtonUI>
                        </>
                    )}
                </div>
            </div>
        </AuthPageShell>
    );
}

export default function AuthConfirmPage() {
    return (
        <Suspense fallback={null}>
            <AuthConfirmContent />
        </Suspense>
    );
}
