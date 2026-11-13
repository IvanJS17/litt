"use client";

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { LIQUID_GLASS_MODAL_CLASS } from "./LiquidGlassUI";
import { CloseButton } from "./CloseButton";

export type ModalUISize = "sm" | "md" | "lg" | "xl";

export interface ModalUIProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    breadcrumbs?: ReactNode[];
    headerAction?: ReactNode;
    size?: ModalUISize;
    className?: string;
    ariaLabel?: string;
    footerStatus?: ReactNode;
    primaryAction?: ReactNode;
    secondaryAction?: ReactNode;
    cancelAction?: ReactNode;
    keepMounted?: boolean;
    /**
     * On a phone (under 768 px) the dialog is a sheet that rises from the
     * bottom edge: grabber, rounded top corners, `dvh` height cap and the
     * home-indicator inset below the footer. Off by default so the Word
     * task pane, which shares this component, does not change; the web
     * adapter turns it on. From 768 px up it is the centred dialog.
     */
    sheet?: boolean;
}

const sizeClassName: Record<ModalUISize, string> = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
};

/** A finger is the primary pointer: no hover, and a focused text field opens
 * the on-screen keyboard. */
const prefersTouch = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(pointer: coarse)").matches === true;

/** How long the sheet's exit animation runs (see LiquidGlassUI.css). */
const SHEET_EXIT_MS = 180;

/** A phone with motion allowed: the sheet slides, so it must stay mounted
 * while it leaves. With "Reduce motion" it just appears and disappears. */
const sheetAnimates = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(max-width: 767px)").matches === true &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches === true;

/** An element that opens the on-screen keyboard when it takes focus. */
function isTextEntry(element: Element | null): boolean {
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLInputElement) {
        return !["checkbox", "radio", "range", "button", "submit", "reset", "file", "image", "color"].includes(
            element.type,
        );
    }
    return element instanceof HTMLElement && element.isContentEditable;
}

export function ModalUI({
    open,
    onClose,
    children,
    breadcrumbs,
    headerAction,
    size = "lg",
    className = "",
    ariaLabel,
    footerStatus,
    primaryAction,
    secondaryAction,
    cancelAction,
    keepMounted = false,
    sheet = false,
}: ModalUIProps) {
    const [hasMounted, setHasMounted] = useState(false);
    // Held true for the length of the sheet's exit animation after `open`
    // turns false (adjusted while rendering, so the sheet never unmounts
    // for a frame first).
    const [closing, setClosing] = useState(false);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        setClosing(!open && sheet && sheetAnimates());
    }
    useEffect(() => {
        if (!closing) return;
        const timer = window.setTimeout(() => setClosing(false), SHEET_EXIT_MS);
        return () => window.clearTimeout(timer);
    }, [closing]);
    const dialogRef = useRef<HTMLElement>(null);
    const onCloseRef = useRef(onClose);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- portals cannot render during SSR
    useEffect(() => setHasMounted(true), []);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    // On a phone, a field focused as the dialog opens (`autoFocus`) raises
    // the keyboard over the dialog before it has been read. Hand focus to the
    // dialog itself; the field takes it when it is tapped. Layout effect, so
    // it runs in the commit that mounted the field, before the keyboard shows.
    useLayoutEffect(() => {
        if (!open || !hasMounted || !prefersTouch()) return;
        const dialog = dialogRef.current;
        const active = document.activeElement;
        if (dialog && active && dialog.contains(active) && isTextEntry(active)) {
            dialog.focus({ preventScroll: true });
        }
    }, [open, hasMounted]);

    useEffect(() => {
        if (!open) return;
        const touch = prefersTouch();
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const dialog = dialogRef.current;
        const focusable = (): HTMLElement[] =>
            dialog
                ? Array.from(
                      dialog.querySelectorAll<HTMLElement>(
                          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
                      ),
                  ).filter((element) => !element.hasAttribute("hidden"))
                : [];

        window.requestAnimationFrame(() => {
            // React's `autoFocus` prop focuses the element on mount but never
            // writes an `autofocus` attribute, so the attribute probe below
            // never matched and this frame stole focus from the intended
            // field to the first focusable (the Close button). If something
            // inside the dialog already holds focus, leave it there.
            const active = document.activeElement as HTMLElement | null;
            if (dialog && active && active !== dialog && dialog.contains(active)) {
                return;
            }
            // The layout effect above already parked focus on the dialog for
            // a finger; leave it there.
            if (touch && active === dialog) return;
            // With a finger, never pick a text field: that opens the keyboard.
            const candidates = touch
                ? focusable().filter((element) => !isTextEntry(element))
                : focusable();
            const target =
                candidates.find((element) =>
                    element.hasAttribute("autofocus"),
                ) ??
                candidates[0] ??
                dialog;
            target?.focus();
        });

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                // A control inside the dialog (an open listbox or menu) that
                // handled Escape itself marks it handled; only close for an
                // Escape nothing else claimed.
                if (!event.defaultPrevented) onCloseRef.current();
                return;
            }
            if (event.key !== "Tab") return;

            const items = focusable();
            if (items.length === 0) {
                event.preventDefault();
                dialog?.focus();
                return;
            }

            const first = items[0]!;
            const last = items[items.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            previouslyFocused?.focus();
        };
    }, [open]);

    const visible = open || closing;
    if (!visible && (!keepMounted || !hasMounted)) return null;

    const hasHeader = Boolean(breadcrumbs?.length);
    const hasFooter = Boolean(
        footerStatus || primaryAction || secondaryAction || cancelAction,
    );

    return createPortal(
        <div
            data-state={open ? "open" : "closed"}
            className={`fixed inset-0 z-[200] flex items-center justify-center bg-white/10 px-4 py-4 backdrop-blur-[2px] ${sheet ? "modal-sheet-backdrop max-md:items-end max-md:p-0" : ""} ${visible ? "" : "hidden"} ${closing ? "pointer-events-none" : ""}`}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                aria-hidden={open ? undefined : true}
                tabIndex={-1}
                className={`flex w-full flex-col rounded-3xl ${LIQUID_GLASS_MODAL_CLASS} backdrop-blur-3xl ${sizeClassName[size]} ${sheet ? "modal-sheet max-md:max-h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top)))] max-md:max-w-none max-md:rounded-b-none max-md:pb-[env(safe-area-inset-bottom)]" : ""} ${className}`}
            >
                {sheet && (
                    <div
                        aria-hidden="true"
                        data-slot="modal-grabber"
                        className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-gray-300 md:hidden"
                    />
                )}
                {hasHeader && (
                    <header className="flex items-center justify-between gap-3 p-4 pl-5">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs leading-none text-gray-400">
                                {breadcrumbs?.map((segment, index) => (
                                    <span
                                        key={index}
                                        className="flex items-center gap-1.5"
                                    >
                                        {index > 0 && <span>›</span>}
                                        <span
                                            className={`truncate ${index === breadcrumbs.length - 1 ? "text-gray-700" : ""}`}
                                        >
                                            {segment}
                                        </span>
                                    </span>
                                ))}
                            </div>
                            {headerAction}
                        </div>
                        <CloseButton onClick={onClose} size="md" />
                    </header>
                )}

                {/* Scroll gutters protect shadows and focus rings without moving
                    content. Mark body scrollers explicitly so nested menus and
                    inset panels keep their own spacing. */}
                <div className="flex min-h-0 flex-1 flex-col px-5 [&_[data-modal-scroll]]:-mx-2 [&_[data-modal-scroll]]:px-2 [&_[data-modal-scroll=horizontal]]:-my-2 [&_[data-modal-scroll=horizontal]]:py-2">
                    {children}
                </div>

                {hasFooter && (
                    <footer
                        className={`flex items-center gap-3 border-t border-white/60 p-3 ${secondaryAction ? "justify-between" : "justify-end"}`}
                    >
                        {secondaryAction && (
                            <div className="flex min-w-0 items-center gap-2">
                                {secondaryAction}
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            {footerStatus}
                            {cancelAction}
                            {primaryAction}
                        </div>
                    </footer>
                )}
            </section>
        </div>,
        document.body,
    );
}
