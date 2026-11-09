"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
    InputUI,
    PillButtonUI,
    pillButtonUIClassName,
    authGlassCardUIClassName,
    authInputUIClassName,
} from "@mike/ui";
import {
    MIN_PASSWORD_LENGTH,
    isPasswordTooLong,
    maximumPasswordMessage,
    minimumPasswordMessage,
} from "@/app/components/auth/passwordPolicy";
import { authMessages, PASSWORD_LENGTH_MESSAGE } from "@/app/lib/authMessages";
import {
    exchangeAuthCode,
    getAuthSession,
    startInviteSession,
    updateAuthPassword,
} from "@/app/lib/authApi";
import { useAuth } from "@/app/contexts/AuthContext";
import { FieldLabel } from "@/app/components/ui/form-field";
import { describeError } from "@/app/lib/userFacingError";

const SET_PASSWORD_ERROR_MESSAGES = authMessages({
    validation_failed: PASSWORD_LENGTH_MESSAGE,
    invalid_request: PASSWORD_LENGTH_MESSAGE,
});

/**
 * Where the invitation email lands: GoTrue verified the link and sends the
 * person here with a session (tokens in the URL hash; a `code` is accepted
 * too). They choose a password and carry on with the normal onboarding,
 * where their organization invitation is waiting.
 */
function SetPasswordContent() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { refreshSession } = useAuth();
    const [ready, setReady] = useState(false);
    const [linkInvalid, setLinkInvalid] = useState(false);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Once per visit: the hash is erased as it is read, so a second run (React
    // strict mode, a changed dependency) must not look for it again.
    const started = useRef(false);
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        async function takeSession() {
            const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
            const accessToken = hash.get("access_token");
            const refreshToken = hash.get("refresh_token");
            const code = searchParams.get("code");
            try {
                if (accessToken && refreshToken) {
                    // The tokens must not stay in the address bar or history.
                    window.history.replaceState(null, "", window.location.pathname);
                    await startInviteSession(accessToken, refreshToken);
                    await refreshSession();
                } else if (code) {
                    await exchangeAuthCode(code);
                    await refreshSession();
                } else if (!(await getAuthSession())) {
                    throw new Error("no session");
                }
            } catch {
                setLinkInvalid(true);
            }
            setReady(true);
        }
        void takeSession();
    }, [refreshSession, searchParams]);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`${minimumPasswordMessage}.`);
            return;
        }
        if (isPasswordTooLong(password)) {
            setError(maximumPasswordMessage);
            return;
        }
        if (password !== confirmPassword) {
            setError(t("access.setPassword.mismatch"));
            return;
        }
        setLoading(true);
        try {
            await updateAuthPassword(password);
            router.replace("/onboarding/profile");
        } catch (caught) {
            setError(
                describeError(caught, {
                    action: "update your password",
                    codeMessages: SET_PASSWORD_ERROR_MESSAGES,
                    fallback: t("access.setPassword.invalid"),
                }).message,
            );
            setLoading(false);
        }
    }

    return (
        <AuthPageShell align={ready && !linkInvalid ? "top" : "center"}>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    {!ready ? (
                        <div>
                            <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
                            <h1 className="mt-4 font-serif text-2xl font-medium text-gray-950">
                                {t("access.setPassword.verifying")}
                            </h1>
                        </div>
                    ) : linkInvalid ? (
                        <div>
                            <h1 className="font-serif text-2xl font-medium text-gray-950">
                                {t("access.setPassword.invalidTitle")}
                            </h1>
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">
                                {t("access.setPassword.invalid")}
                            </p>
                            <Link
                                href="/login"
                                className={pillButtonUIClassName({
                                    tone: "black",
                                    size: "normal",
                                    className: "mt-6",
                                })}
                            >
                                {t("access.setPassword.toLogin")}
                            </Link>
                        </div>
                    ) : (
                        <>
                            <h1 className="font-serif text-2xl font-medium text-gray-950">
                                {t("access.setPassword.title")}
                            </h1>
                            <p className="mt-2 text-sm text-gray-500">
                                {t("access.setPassword.subtitle", { min: MIN_PASSWORD_LENGTH })}
                            </p>
                            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                                <div>
                                    <FieldLabel htmlFor="password">
                                        {t("access.setPassword.password")}
                                    </FieldLabel>
                                    <InputUI
                                        id="password"
                                        type="password"
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        required
                                        className={`w-full ${authInputUIClassName}`}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor="confirmPassword">
                                        {t("access.setPassword.confirm")}
                                    </FieldLabel>
                                    <InputUI
                                        id="confirmPassword"
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirmPassword}
                                        onChange={(event) => setConfirmPassword(event.target.value)}
                                        required
                                        className={`w-full ${authInputUIClassName}`}
                                    />
                                </div>
                                {error && (
                                    <div role="alert" className="rounded bg-red-50 p-3 text-sm text-red-600">
                                        {error}
                                    </div>
                                )}
                                <PillButtonUI
                                    type="submit"
                                    tone="black"
                                    size="normal"
                                    disabled={loading || !password || !confirmPassword}
                                    className="w-full"
                                >
                                    {loading ? t("access.setPassword.saving") : t("access.setPassword.submit")}
                                </PillButtonUI>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </AuthPageShell>
    );
}

export default function SetPasswordPage() {
    return (
        <Suspense fallback={null}>
            <SetPasswordContent />
        </Suspense>
    );
}
