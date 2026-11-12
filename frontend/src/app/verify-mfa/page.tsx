"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PillButtonUI, authGlassCardUIClassName } from "@mike/ui";
import { useAuth } from "@/app/contexts/AuthContext";
import { challengeAndVerifyMfa, listMfaFactors } from "@/app/lib/authApi";
import {
    needsMfaVerification,
    VerificationCodeInput,
} from "@/app/components/popups/MfaVerificationPopup";
import { markMfaVerifiedForGate } from "@/app/components/shared/MfaLoginGate";
import { reportFault,
    UserVisibleError,
    describeError,
    supportMailtoFor,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import { authMessages } from "@/app/lib/authMessages";
import { clientTranslator } from "@mike/client";
import { useTranslations } from "next-intl";

/** The shared auth table with this screen's deltas. */
const MFA_ERROR_MESSAGES = authMessages({
    // Only here is a missing authenticator a lock-out rather than a
    // settings row that disappeared.
    mfa_factor_not_found: () => clientTranslator()("auth.verifyMfa.factorNotRegistered"),
    validation_failed: () => clientTranslator()("auth.verifyMfa.enterSixDigitCode"),
    invalid_request: () => clientTranslator()("auth.verifyMfa.enterSixDigitCode"),
});

type MfaFactor = {
    id: string;
    friendly_name?: string | null;
    factor_type: string;
};

export default function VerifyMfaPage() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, authLoading, signOut } = useAuth();
    const [factors, setFactors] = useState<MfaFactor[]>([]);
    const [selectedFactorId, setSelectedFactorId] = useState("");
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState<UserFacingError | null>(null);
    const isMfaPreview =
        process.env.NODE_ENV !== "production" &&
        searchParams.get("preview") === "mfa";
    const displayedFactors = isMfaPreview
        ? [
              {
                  id: "preview-factor",
                  friendly_name: t("auth.verifyMfa.authenticatorApp"),
                  factor_type: "totp",
              },
          ]
        : factors;
    const displayedFactorId = isMfaPreview
        ? "preview-factor"
        : selectedFactorId;
    const displayedLoading = isMfaPreview ? false : loading;

    const nextPath = safeNextPath(searchParams.get("next"));
    const canVerify =
        !displayedLoading &&
        !verifying &&
        !!displayedFactorId &&
        code.trim().length === 6;

    useEffect(() => {
        if (isMfaPreview) return;

        if (authLoading) return;
        if (!user) {
            router.replace("/login");
            return;
        }

        let cancelled = false;

        async function loadMfaState() {
            setLoading(true);
            setError(null);
            setCode("");
            try {
                const required = await needsMfaVerification();
                if (cancelled) return;
                if (!required) {
                    router.replace(nextPath);
                    return;
                }

                const data = await listMfaFactors();
                if (cancelled) return;

                const verified = (data.totp ?? []) as MfaFactor[];
                setFactors(verified);
                setSelectedFactorId(verified[0]?.id ?? "");
                if (verified.length === 0) {
                    setError(
                        describeError(
                            new UserVisibleError(
                                t("auth.verifyMfa.noVerifiedAuthenticator"),
                                { kind: "forbidden" },
                            ),
                            { action: t("auth.verifyMfa.verifyIdentityAction") },
                        ),
                    );
                }
            } catch (caught) {
                if (cancelled) return;
                setError(
                    reportFault(caught, {
                        action: t("auth.verifyMfa.loadAction"),
                        codeMessages: MFA_ERROR_MESSAGES,
                        fallback: t("auth.verifyMfa.loadFailed"),
                        operation: "auth.mfa",
                    }),
                );
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadMfaState();

        return () => {
            cancelled = true;
        };
    }, [authLoading, isMfaPreview, nextPath, router, t, user]);

    async function verify() {
        if (!canVerify) return;

        setVerifying(true);
        setError(null);
        try {
            await challengeAndVerifyMfa(displayedFactorId, code.trim());
        } catch (caught) {
            setVerifying(false);
            setError(
                reportFault(caught, {
                    action: t("auth.verifyMfa.verifyCodeAction"),
                    codeMessages: MFA_ERROR_MESSAGES,
                    fallback: t("auth.verifyMfa.codeInvalid"),
                    operation: "auth.mfa",
                }),
            );
            return;
        }

        setVerifying(false);
        setCode("");
        markMfaVerifiedForGate();
        router.replace(nextPath);
    }

    async function cancel() {
        setError(null);
        try {
            await signOut();
            router.replace("/login");
        } catch (caught) {
            setError(
                reportFault(caught, {
                    action: t("auth.verifyMfa.signOutAction"),
                    fallback: t("auth.verifyMfa.signOutFailed"),
                    operation: "auth.session",
                }),
            );
        }
    }

    return (
        <AuthPageShell>
            <div className={`w-full max-w-md ${authGlassCardUIClassName}`}>
                <div className="mb-8 space-y-2">
                    <h1 className="font-serif text-2xl font-medium text-gray-950">
                        {t("auth.verifyMfa.verifyYourIdentity")}
                    </h1>
                    <p className="text-sm text-gray-500">
                        {t("auth.verifyMfa.enterTheSixDigitCodeFrom")}
                    </p>
                </div>

                <div className="space-y-6">
                    {displayedLoading ? (
                        <div className="flex h-13 items-center justify-center text-sm text-gray-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t("auth.verifyMfa.loadingAuthenticator")}
                        </div>
                    ) : displayedFactors.length === 0 ? (
                        <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
                            {t("auth.verifyMfa.noVerifiedAuthenticatorFactorIsAvailable")}
                        </p>
                    ) : (
                        <>
                            {displayedFactors.length > 1 && (
                                <select
                                    value={displayedFactorId}
                                    onChange={(event) =>
                                        setSelectedFactorId(event.target.value)
                                    }
                                    className="h-9 w-full rounded-lg border border-transparent bg-gray-100 px-3 text-sm text-gray-900 shadow-none outline-none focus-visible:border-gray-200 focus-visible:ring-2 focus-visible:ring-gray-300/45"
                                >
                                    {displayedFactors.map((factor) => (
                                        <option
                                            key={factor.id}
                                            value={factor.id}
                                        >
                                            {factor.friendly_name ||
                                                t("auth.verifyMfa.authenticatorApp")}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <VerificationCodeInput
                                value={code}
                                onChange={setCode}
                                disabled={verifying}
                                autoFocus={!displayedLoading}
                                canSubmit={canVerify}
                                onSubmit={() => void verify()}
                            />
                        </>
                    )}

                    {error && (
                        <p role="alert" className="text-sm text-red-600">
                            {error.message}
                            {error.supportable && (
                                <a
                                    href={supportMailtoFor(
                                        error,
                                        "Failed two-factor verification at login.",
                                    )}
                                    className="ml-2 underline underline-offset-2"
                                >
                                    {t("auth.verifyMfa.contactSupport")}
                                </a>
                            )}
                        </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={() => void cancel()}
                            disabled={verifying}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                            {t("auth.verifyMfa.cancel")}
                        </button>
                        <PillButtonUI
                            tone="black"
                            size="normal"
                            type="button"
                            onClick={() => void verify()}
                            disabled={!canVerify}
                            loading={verifying}
                        >
                            {verifying ? t("auth.verifyMfa.verifying") : t("auth.verifyMfa.verify")}
                        </PillButtonUI>
                    </div>
                </div>
            </div>
        </AuthPageShell>
    );
}

function safeNextPath(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
        return "/assistant";
    }
    if (value.startsWith("/verify-mfa")) return "/assistant";
    return value;
}
