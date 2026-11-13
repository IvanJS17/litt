"use client";

/**
 * Web adapter for the shared toast system. Mount `<AppToasts />` once in the
 * root providers. It renders the viewport in the bottom-right corner, draws
 * every error notice as a `WarningPopup`, and raises a single offline notice
 * while the browser reports no connection.
 */

import { useEffect, useMemo } from "react";
import {
    ToastActionsUI,
    ToastViewportUI,
    dismissToast,
    showToast,
    toastHasActions,
    useExitingToasts,
    useToasts,
} from "@mike/ui";
import {
    NOTICE_STACK_POSITION_CLASS,
    WarningPopup,
} from "@/app/components/popups/WarningPopup";
import { useTranslations } from "next-intl";

export {
    ToastViewportUI,
    clearToasts,
    dismissToast,
    showToast,
    useToasts,
    type ToastAction,
    type ToastInput,
    type ToastRecord,
    type ToastTone,
} from "@mike/ui";

export const OFFLINE_TOAST_KEY = "connectivity";

export function useOfflineNotice() {
    const t = useTranslations();
    useEffect(() => {
        let offlineToastId: string | null = null;

        const onOffline = () => {
            offlineToastId = showToast({
                tone: "error",
                title: t("ui.youreOffline"),
                message:
                    t("ui.changesCantBeSavedUntilYour"),
                durationMs: null,
                dedupeKey: OFFLINE_TOAST_KEY,
            });
        };
        const onOnline = () => {
            if (offlineToastId) {
                dismissToast(offlineToastId);
                offlineToastId = null;
                showToast({
                    tone: "success",
                    message: t("ui.youreBackOnline"),
                    dedupeKey: OFFLINE_TOAST_KEY,
                });
            }
        };

        window.addEventListener("offline", onOffline);
        window.addEventListener("online", onOnline);
        if (navigator.onLine === false) onOffline();
        return () => {
            window.removeEventListener("offline", onOffline);
            window.removeEventListener("online", onOnline);
        };
    }, []);
}

export function AppToasts() {
    useOfflineNotice();
    const toasts = useToasts();
    const errors = useMemo(
        () => toasts.filter((toast) => toast.tone === "error"),
        [toasts],
    );
    const warnings = useExitingToasts(errors);

    return (
        <>
            {/* Bottom-right, so a notice never covers the page header or
                the first lines of the page. */}
            <ToastViewportUI
                showErrors={false}
                className={NOTICE_STACK_POSITION_CLASS}
            />
            {warnings.map(({ item: toast, leaving }) => (
                <WarningPopup
                    key={toast.id}
                    open
                    leaving={leaving}
                    title={toast.title}
                    message={toast.message}
                    onClose={() => dismissToast(toast.id)}
                    actions={
                        toastHasActions(toast) ? (
                            <ToastActionsUI toast={toast} />
                        ) : undefined
                    }
                />
            ))}
        </>
    );
}
