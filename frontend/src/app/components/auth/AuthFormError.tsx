"use client";

import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { CloseButton } from "@mike/ui";
import { useTranslations } from "next-intl";

/** Text-link styling for an action inside the inline error. */
const ACTION_CLASS =
    "rounded-sm font-medium text-gray-900 underline underline-offset-2 transition-colors hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:no-underline disabled:opacity-60";

interface AuthFormErrorProps {
    /** Bold first line, e.g. "Couldn't log in". Omit for a message alone. */
    title?: ReactNode;
    message: ReactNode;
    /** Shown only when retrying is honest (the failure is retryable). */
    retry?: { label: ReactNode; onClick: () => void; disabled?: boolean };
    /** Pre-filled support email, only for a failure the user cannot fix. */
    supportHref?: string;
    /** Adds the ✕; without it the error stays until the next attempt. */
    onDismiss?: () => void;
}

/**
 * A failure on a signed-out form, drawn inside the card next to the action
 * that failed. The signed-out screens put the LiTT wordmark at the top of
 * the page, so a floating notice there would cover it; here the error sits
 * where the person is already looking. Same content as a `WarningPopup`
 * (title, message, Retry, Contact support), announced with `role="alert"`.
 */
export function AuthFormError({
    title,
    message,
    retry,
    supportHref,
    onDismiss,
}: AuthFormErrorProps) {
    const t = useTranslations();
    return (
        <div
            role="alert"
            data-slot="auth-form-error"
            className="relative flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm"
        >
            <AlertCircle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
            />
            <div
                className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${onDismiss ? "pr-5" : ""}`}
            >
                {title ? (
                    <p className="font-medium text-red-600">{title}</p>
                ) : null}
                <p className={title ? "text-gray-700" : "text-red-600"}>
                    {message}
                </p>
                {retry || supportHref ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                        {retry ? (
                            <button
                                type="button"
                                onClick={retry.onClick}
                                disabled={retry.disabled}
                                className={ACTION_CLASS}
                            >
                                {retry.label}
                            </button>
                        ) : null}
                        {supportHref ? (
                            <a href={supportHref} className={ACTION_CLASS}>
                                {t("auth.form.contactSupport")}
                            </a>
                        ) : null}
                    </div>
                ) : null}
            </div>
            {onDismiss ? (
                <CloseButton
                    onClick={onDismiss}
                    label={t("auth.form.dismissWarning")}
                    size="sm"
                    className="absolute right-2 top-2"
                />
            ) : null}
        </div>
    );
}
