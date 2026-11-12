"use client";

import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, NoticeCardUI, useNoticeStackSlot } from "@mike/ui";

/**
 * A single warning that the calling component opens and closes itself.
 *
 * Its card is `NoticeCardUI`, the same card the toast stack draws, so a
 * popup and a toast always look alike. This wrapper adds only what a popup
 * needs on top: the `open` prop, a portal to the bottom-right corner, and
 * closing on Escape.
 *
 * Every warning in the web app is a WarningPopup. A component renders one
 * for a failure on its own screen; `notifyError` reaches code that has no
 * component, and `AppToasts` draws what it raises with this same popup.
 * Toasts are for success and information. docs/design-system.md has the
 * full rule.
 *
 * While the toast viewport is mounted the card joins its column, so a popup
 * and a toast stack instead of overlapping.
 */

/**
 * Where the web app's notices sit: the bottom-right corner, clear of the
 * page header and of the first lines of content at the top. On a phone the
 * column spans the width, above the home indicator. On a page with a chat
 * composer, `.notice-stack` in globals.css lifts the column above it, so a
 * warning never covers Send. `AppToasts` passes this to `ToastViewportUI`
 * (whose own default, top centre, is the Word add-in's) and a popup with no
 * viewport mounted uses it too.
 */
export const NOTICE_STACK_POSITION_CLASS =
    "notice-stack left-3 right-3 top-auto bottom-[max(0.75rem,env(safe-area-inset-bottom))] w-auto translate-x-0 px-0 sm:left-auto sm:right-5 sm:bottom-5 sm:w-[min(calc(100vw-2.5rem),400px)]";

interface WarningPopupAction {
    label: ReactNode;
    onClick: () => void;
    disabled?: boolean;
}

interface WarningPopupProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    message?: ReactNode;
    children?: ReactNode;
    icon?: ReactNode;
    primaryAction?: WarningPopupAction;
    /**
     * Extra buttons or links for the action row, before `primaryAction`.
     * `primaryAction` is always the black pill, so nothing here may be one
     * when it is set; style these with `noticeActionClassName`.
     */
    actions?: ReactNode;
    className?: string;
}

export function WarningPopup({
    open,
    onClose,
    title,
    message,
    children,
    icon,
    primaryAction,
    actions,
    className,
}: WarningPopupProps) {
    const t = useTranslations();
    const stackSlot = useNoticeStackSlot();

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose, open]);

    if (!open) return null;

    const card = (
        <NoticeCardUI
            tone="error"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            title={title}
            message={message}
            icon={icon}
            onDismiss={onClose}
            dismissLabel={t("popups.dismissWarning")}
            className={className}
            actions={
                actions || primaryAction ? (
                    <>
                        {actions}
                        {primaryAction ? (
                            <PillButtonUI
                                tone="black"
                                size="sm"
                                onClick={primaryAction.onClick}
                                disabled={primaryAction.disabled}
                            >
                                {primaryAction.label}
                            </PillButtonUI>
                        ) : null}
                    </>
                ) : undefined
            }
        >
            {children}
        </NoticeCardUI>
    );

    if (stackSlot) return createPortal(card, stackSlot);

    return createPortal(
        <div
            className={`pointer-events-none fixed z-[220] ${NOTICE_STACK_POSITION_CLASS}`}
        >
            {card}
        </div>,
        document.body,
    );
}
