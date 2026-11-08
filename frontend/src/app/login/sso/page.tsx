"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authGlassCardUIClassName, authInputUIClassName, InputUI, PillButtonUI } from "@mike/ui";
import { FieldLabel } from "@/app/components/ui/form-field";
import { AuthFormError } from "@/app/components/auth/AuthFormError";
import { useAuth } from "@/app/contexts/AuthContext";
import { startSso } from "@/app/lib/authApi";
import { reportFault,
    supportMailtoFor,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import { authMessages } from "@/app/lib/authMessages";
import { useTranslations } from "next-intl";

/** The shared auth table with this screen's deltas: the address asked for
 *  here is a work address, so "valid email" is not specific enough. */
const SSO_ERROR_MESSAGES = authMessages({
    invalid_request: "Enter a valid company email address.",
    validation_failed: "Enter a valid company email address.",
    email_address_invalid: "Enter a valid company email address.",
});

export default function SsoLoginPage() {
    const t = useTranslations();
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<UserFacingError | null>(null);

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/onboarding/profile");
        }
    }, [authLoading, isAuthenticated, router]);

    const startSsoFlow = async () => {
        setLoading(true);
        setError(null);

        try {
            const { url } = await startSso(
                "/onboarding/profile",
                email.trim(),
            );
            window.location.assign(url);
        } catch (caught) {
            const described = reportFault(caught, {
                action: "start single sign-on",
                codeMessages: SSO_ERROR_MESSAGES,
                fallback: "Unable to start single sign-on. Try again.",
                operation: "auth.signin",
            });
            setError(
                described.kind === "rate_limited"
                    ? {
                          ...described,
                          message:
                              t("auth.sso.tooManyAttempts"),
                      }
                    : described,
            );
            setLoading(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        await startSsoFlow();
    };

    return (
        <AuthPageShell>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    <div className="mb-6">
                        <h1 className="font-serif text-2xl font-medium text-gray-950">
                            {t("auth.sso.ssoLogin")}
                        </h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <FieldLabel htmlFor="sso-email">
                                {t("auth.sso.email")}
                            </FieldLabel>
                            <InputUI
                                id="sso-email"
                                type="email"
                                autoComplete="email"
                                autoCapitalize="none"
                                spellCheck={false}
                                placeholder="you@company.com"
                                value={email}
                                onChange={(event) =>
                                    setEmail(event.target.value)
                                }
                                required
                                disabled={loading}
                                className={authInputUIClassName}
                            />
                        </div>

                        {error && (
                            <AuthFormError
                                message={error.message}
                                retry={
                                    error.retryable
                                        ? {
                                              label: t("auth.sso.retry"),
                                              onClick: () =>
                                                  void startSsoFlow(),
                                              disabled: loading,
                                          }
                                        : undefined
                                }
                                supportHref={
                                    error.supportable
                                        ? supportMailtoFor(
                                              error,
                                              "Failed to start single sign-on.",
                                          )
                                        : undefined
                                }
                            />
                        )}

                        <div className="pt-2">
                            <PillButtonUI
                                type="submit"
                                tone="black"
                                size="normal"
                                className="w-full"
                                disabled={loading || !email.trim()}
                                aria-busy={loading}
                            >
                                {loading && (
                                    <Loader2
                                        aria-hidden="true"
                                        className="h-4 w-4 animate-spin"
                                    />
                                )}
                                {loading ? t("auth.sso.continuing") : t("auth.sso.continue")}
                            </PillButtonUI>
                        </div>
                    </form>
                </div>

                <div className="mt-4 text-center text-sm text-gray-500">
                    <Link
                        href="/login"
                        className="font-medium transition-colors hover:text-gray-950"
                    >
                        {t("auth.sso.backToLogin")}
                    </Link>
                </div>
            </div>
        </AuthPageShell>
    );
}
