"use client";

import { useState } from "react";
import { GoogleIconUI, PillButtonUI } from "@mike/ui";
import { startGoogleOAuth } from "@/app/lib/authApi";
import {
    describeError,
    type UserFacingError,
} from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";

interface GoogleAuthButtonProps {
    /** Receives a classified failure, or `null` when the error is cleared. */
    onError: (error: UserFacingError | null) => void;
    disabled?: boolean;
    onLoadingChange?: (loading: boolean) => void;
}

export function GoogleAuthButton({
    onError,
    disabled = false,
    onLoadingChange,
}: GoogleAuthButtonProps) {
    const t = useTranslations();
    const [loading, setLoading] = useState(false);

    const handleGoogleAuth = async () => {
        setLoading(true);
        onLoadingChange?.(true);
        onError(null);

        try {
            const { url } = await startGoogleOAuth("/onboarding/profile");
            window.location.assign(url);
        } catch (error: unknown) {
            // A provider error message ("invalid_client", a stack line) is
            // never shown; the caller renders the classified text instead.
            onError(
                describeError(error, {
                    action: t("auth.form.googleAction"),
                    codeMessages: {
                        provider_disabled: t("auth.form.googleDisabled"),
                        oauth_provider_not_supported: t("auth.form.googleDisabled"),
                        over_request_rate_limit: t("auth.errors.tooManyAttempts"),
                    },
                    fallback: t("auth.form.googleFailed"),
                }),
            );
            setLoading(false);
            onLoadingChange?.(false);
        }
    };

    return (
        <PillButtonUI
            type="button"
            tone="white"
            size="normal"
            className="w-full"
            disabled={disabled || loading}
            loading={loading}
            onClick={() => void handleGoogleAuth()}
        >
            <GoogleIconUI className="h-4 w-4" />
            {loading ? t("auth.sso.continuing") : t("auth.form.continueWithGoogle")}
        </PillButtonUI>
    );
}
