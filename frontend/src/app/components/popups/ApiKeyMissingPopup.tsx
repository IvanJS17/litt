"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { WarningPopup } from "../popups/WarningPopup";
import { useTranslations } from "next-intl";

interface Props {
    open: boolean;
    onClose: () => void;
    /** Optional override for the body sentence. */
    message?: string;
    /** Optional override for the heading — e.g. a rejected key, not a missing one. */
    title?: string;
}

export function ApiKeyMissingPopup({
    open,
    onClose,
    message,
    title,
}: Props) {
    const t = useTranslations();
    const router = useRouter();
    if (!open) return null;

    const body =
        message ??
        t("popups.youHaventEnabledAnyModelsYet");

    const handleGoToSettings = () => {
        onClose();
        router.push("/settings/byok");
    };

    return (
        <WarningPopup
            open={open}
            onClose={onClose}
            title={title ?? t("popups.apiKeyRequired")}
            message={body}
            icon={
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            }
            primaryAction={{
                label: t("popups.goToSettings"),
                onClick: handleGoToSettings,
            }}
        />
    );
}
