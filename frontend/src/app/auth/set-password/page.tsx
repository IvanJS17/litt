"use client";

import { clientTranslator } from "@mike/client";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { SignupLegal } from "@/app/components/legal/SignupLegal";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
    PasswordInputUI,
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
import { authMessages, PASSWORD_LENGTH_MESSAGE } from "@/app/lib/authMessages";
import {
    exchangeAuthCode,
    getAuthSession,
    logout,
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

/** The address an invitation link's access token names (display only; the server checks the token). */
function addressOfLink(accessToken: string): string | null {
    try {
        const payload = accessToken.split(".")[1] ?? "";
        const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
        const email = (JSON.parse(json) as { email?: unknown }).email;
        return typeof email === "string" && email ? email : null;
    } catch {
        return null;
    }
}

type PendingLink = { invited: string; current: string | null };

/**
 * Where the invitation email lands: GoTrue verified the link and sends the
 * person here with a session (tokens in the URL hash; a `code` is accepted
 * too). The session in the link is only adopted after the person confirms,
 * and never over a session of another account without their say. They then
 * choose a password and carry on with the normal onboarding (the invitation
 * to the firm comes first), where their organization invitation is waiting.
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
    const [pending, setPending] = useState<PendingLink | null>(null);
    const [continuing, setContinuing] = useState(false);
    // The link's tokens wait here, out of the address bar, until confirmed.
    const linkTokens = useRef<{ accessToken: string; refreshToken: string } | null>(null);

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
                    const invited = addressOfLink(accessToken);
                    if (!invited) throw new Error("unreadable link");
                    const current = await getAuthSession();
                    linkTokens.current = { accessToken, refreshToken };
                    setPending({ invited, current: current?.email ?? null });
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

    async function adoptLink(replaceCurrent: boolean) {
        const tokens = linkTokens.current;
        if (!tokens) return;
        setContinuing(true);
        try {
            if (replaceCurrent) await logout("local");
            await startInviteSession(tokens.accessToken, tokens.refreshToken);
            linkTokens.current = null;
            await refreshSession();
            setPending(null);
        } catch {
            linkTokens.current = null;
            setPending(null);
            setLinkInvalid(true);
        }
        setContinuing(false);
    }

    function stayWithCurrentSession() {
        linkTokens.current = null;
        router.replace("/assistant");
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        if (!password || !confirmPassword) {
            // The button is always live; this says what is missing.
            setError(t("auth.errors.enterBothPasswords"));
            document.getElementById(password ? "confirmPassword" : "password")?.focus();
            return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            setError(t("auth.errors.passwordTooShort", { min: MIN_PASSWORD_LENGTH }));
            return;
        }
        if (isPasswordTooLong(password)) {
            setError(t("auth.errors.passwordTooLong", { max: MAX_PASSWORD_LENGTH }));
            return;
        }
        if (password !== confirmPassword) {
            setError(t("access.setPassword.mismatch"));
            return;
        }
        setLoading(true);
        try {
            await updateAuthPassword(password);
            router.replace("/onboarding/invitations");
        } catch (caught) {
            setError(
                describeError(caught, {
                    action: clientTranslator()("errors.action.updateYourPassword"),
                    codeMessages: SET_PASSWORD_ERROR_MESSAGES,
                    fallback: t("access.setPassword.invalid"),
                }).message,
            );
            setLoading(false);
        }
    }

    return (
        <AuthPageShell>
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
                    ) : pending ? (
                        <div>
                            {pending.current &&
                            pending.current.toLowerCase() !== pending.invited.toLowerCase() ? (
                                <>
                                    <h1 className="font-serif text-2xl font-medium text-gray-950">
                                        {t("access.setPassword.conflictTitle")}
                                    </h1>
                                    <p className="mt-3 break-words text-sm leading-relaxed text-gray-600">
                                        {t("access.setPassword.conflictBody", {
                                            current: pending.current,
                                            invited: pending.invited,
                                        })}
                                    </p>
                                    <div className="mt-6 flex flex-col gap-3">
                                        <PillButtonUI
                                            type="button"
                                            tone="black"
                                            size="normal"
                                            disabled={continuing}
                                            onClick={() => void adoptLink(true)}
                                            className="w-full"
                                        >
                                            {continuing
                                                ? t("access.setPassword.verifying")
                                                : t("access.setPassword.continueAs", { invited: pending.invited })}
                                        </PillButtonUI>
                                        <PillButtonUI
                                            type="button"
                                            tone="white"
                                            size="normal"
                                            disabled={continuing}
                                            onClick={stayWithCurrentSession}
                                            className="w-full"
                                        >
                                            {t("access.setPassword.stay")}
                                        </PillButtonUI>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h1 className="font-serif text-2xl font-medium text-gray-950">
                                        {t("access.setPassword.confirmTitle")}
                                    </h1>
                                    <p className="mt-3 break-words text-sm leading-relaxed text-gray-600">
                                        {t("access.setPassword.confirmBody", { email: pending.invited })}
                                    </p>
                                    <PillButtonUI
                                        type="button"
                                        tone="black"
                                        size="normal"
                                        disabled={continuing}
                                        onClick={() => void adoptLink(false)}
                                        className="mt-6 w-full"
                                    >
                                        {continuing
                                            ? t("access.setPassword.verifying")
                                            : t("access.setPassword.continue")}
                                    </PillButtonUI>
                                </>
                            )}
                        </div>
                    ) : (
                        <>
                            <h1 className="font-serif text-2xl font-medium text-gray-950">
                                {t("access.setPassword.title")}
                            </h1>
                            <p className="mt-2 text-sm text-gray-500">
                                {t("access.setPassword.subtitle", { min: MIN_PASSWORD_LENGTH })}
                            </p>
                            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
                                <div>
                                    <FieldLabel htmlFor="password">
                                        {t("access.setPassword.password")}
                                    </FieldLabel>
                                    <PasswordInputUI
                                        id="password"
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        className={`w-full ${authInputUIClassName}`}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor="confirmPassword">
                                        {t("access.setPassword.confirm")}
                                    </FieldLabel>
                                    <PasswordInputUI
                                        id="confirmPassword"
                                        autoComplete="new-password"
                                        value={confirmPassword}
                                        onChange={(event) => setConfirmPassword(event.target.value)}
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
                                    disabled={loading}
                                    className="w-full"
                                >
                                    {loading ? t("access.setPassword.saving") : t("access.setPassword.submit")}
                                </PillButtonUI>
                            </form>
                            <SignupLegal />
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
