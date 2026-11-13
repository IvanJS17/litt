"use client";

/**
 * Shared toast (snackbar) system for the web app and the Word add-in.
 *
 * The store is a module singleton so any layer, including non-React code
 * such as the API client, can raise a notification with `showToast`. React
 * subscribes through `useToasts`, and `ToastViewportUI` renders the stack
 * once near the root of each client, at the top centre of the page by
 * default (the web app passes a class that moves it to the bottom-right).
 *
 * The viewport also owns the slot a web `WarningPopup` renders into, so
 * popups and toasts share one column and never cover each other.
 *
 * Error toasts stay until dismissed when they carry actions, because a
 * "Retry" that vanishes mid-read is worse than none. Everything else
 * auto-dismisses and pauses while hovered or focused.
 */

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactElement,
} from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
    NoticeCardUI,
    noticeActionClassName,
    noticeActionEmphasis,
} from "./NoticeCardUI";

import {
    dismissToast,
    subscribe,
    getSnapshot,
    getServerSnapshot,
    type ToastAction,
    type ToastRecord,
} from "@mike/client";
import { useTranslations } from "use-intl";
import { useExitingList, type ExitingListEntry } from "./useExitingList";
export { useExitingList, type ExitingListEntry } from "./useExitingList";
export {
    showToast,
    dismissToast,
    dismissToastsWithKey,
    clearToasts,
    MAX_VISIBLE_TOASTS,
    type ToastAction,
    type ToastInput,
    type ToastRecord,
    type ToastTone,
} from "@mike/client";

const toastNodes = new Map<string, HTMLElement>();

/**
 * Move keyboard focus onto a toast. Toasts never take focus on their own —
 * yanking the caret out of what the user is typing is worse than the
 * failure being reported — so a caller that must be acted on immediately
 * asks for it explicitly. Returns false when the toast is not on screen.
 */
export function focusToast(id: string): boolean {
    const node = toastNodes.get(id);
    if (!node) return false;
    node.focus();
    return true;
}

let noticeStackSlot: HTMLElement | null = null;
const noticeStackSlotListeners = new Set<() => void>();

function setNoticeStackSlot(node: HTMLElement | null) {
    if (noticeStackSlot === node) return;
    noticeStackSlot = node;
    for (const listener of noticeStackSlotListeners) listener();
}

function subscribeNoticeStackSlot(listener: () => void) {
    noticeStackSlotListeners.add(listener);
    return () => {
        noticeStackSlotListeners.delete(listener);
    };
}

/**
 * The element at the head of the mounted viewport's column, or null when no
 * viewport is mounted. `WarningPopup` portals its card here so it stacks
 * with the toasts instead of sitting on top of them.
 */
export function useNoticeStackSlot(): HTMLElement | null {
    return useSyncExternalStore(
        subscribeNoticeStackSlot,
        () => noticeStackSlot,
        () => null,
    );
}

export function toastHasActions(toast: ToastRecord): boolean {
    return Boolean(toast.actions?.length || toast.supportHref);
}

/** A toast's "Contact support" link and action buttons, for a card's action row. */
export function ToastActionsUI({ toast }: { toast: ToastRecord }): ReactElement {
    const t = useTranslations();
    const runAction = async (action: ToastAction) => {
        if (!action.keepOpen) dismissToast(toast.id);
        await action.onClick();
    };

    // Contact support comes first, so it is never the primary action
    // unless it is the only one.
    const supportCount = toast.supportHref ? 1 : 0;
    const count = supportCount + (toast.actions?.length ?? 0);

    return (
        <>
            {toast.supportHref && (
                <a
                    href={toast.supportHref}
                    className={noticeActionClassName(
                        noticeActionEmphasis(0, count),
                    )}
                >
                    {toast.supportLabel ?? t("ui.toast.contactSupport")}
                </a>
            )}
            {toast.actions?.map((action, index) => (
                <button
                    key={action.label}
                    type="button"
                    onClick={() => void runAction(action)}
                    className={noticeActionClassName(
                        noticeActionEmphasis(supportCount + index, count),
                        action.tone,
                    )}
                >
                    {action.label}
                </button>
            ))}
        </>
    );
}

export function useToasts(): readonly ToastRecord[] {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** How long a dismissed notice takes to fade out (see `.notice-card` in LiquidGlassUI.css). */
export const NOTICE_EXIT_MS = 150;

/**
 * The toasts to draw, each dismissed one kept for its fade-out — unless a
 * toast with its `dedupeKey` is up again (a Retry that failed again): that
 * one replaces the old card at once, as fading the old one out beside it
 * would show the same notice twice.
 */
export function useExitingToasts(
    toasts: readonly ToastRecord[],
): ExitingListEntry<ToastRecord>[] {
    return useExitingList(toasts, NOTICE_EXIT_MS).filter(
        ({ item, leaving }) =>
            !leaving ||
            !item.dedupeKey ||
            !toasts.some((toast) => toast.dedupeKey === item.dedupeKey),
    );
}

function ToastItemUI({
    toast,
    leaving = false,
}: {
    toast: ToastRecord;
    leaving?: boolean;
}) {
    const t = useTranslations();
    const isError = toast.tone === "error";
    const pausedRef = useRef(false);
    const hoveredRef = useRef(false);
    const focusedRef = useRef(false);
    const deadlineRef = useRef<number | null>(null);
    const remainingRef = useRef<number | null>(toast.durationMs);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const arm = useCallback(() => {
        clearTimer();
        const remaining = remainingRef.current;
        if (remaining === null) return;
        deadlineRef.current = Date.now() + remaining;
        timerRef.current = setTimeout(() => dismissToast(toast.id), remaining);
    }, [clearTimer, toast.id]);

    const pause = useCallback(() => {
        if (pausedRef.current || remainingRef.current === null) return;
        pausedRef.current = true;
        if (deadlineRef.current !== null) {
            remainingRef.current = Math.max(
                1_000,
                deadlineRef.current - Date.now(),
            );
        }
        clearTimer();
    }, [clearTimer]);

    const resume = useCallback(() => {
        if (!pausedRef.current || hoveredRef.current || focusedRef.current) return;
        pausedRef.current = false;
        arm();
    }, [arm]);

    useEffect(() => {
        arm();
        return clearTimer;
    }, [arm, clearTimer]);

    // The card's look lives in NoticeCardUI, shared with WarningPopup. This
    // wrapper adds only toast behaviour: the timer, hover/focus pause, and
    // the node registry `focusToast` uses.
    return (
        <NoticeCardUI
            tone={toast.tone}
            title={toast.title}
            message={toast.message}
            onDismiss={() => dismissToast(toast.id)}
            dismissLabel={t("ui.noticeCard.dismissNotification")}
            leaving={leaving}
            // An error is an `alert` (assertive), as before. A success or an
            // info card is not a live region: a node inserted with its text
            // already inside is announced unreliably, so the viewport writes
            // that text into the polite region it keeps mounted (see
            // `useAnnouncements`). The viewport itself is a plain region, as
            // a live region nested in a live region is announced twice.
            role={isError ? "alert" : undefined}
            // Not in the tab order, but focusable so `focusToast` can put
            // the keyboard on a critical failure and its actions.
            tabIndex={-1}
            ref={(node) => {
                if (node) toastNodes.set(toast.id, node);
                else toastNodes.delete(toast.id);
            }}
            data-testid="toast"
            onMouseEnter={() => { hoveredRef.current = true; pause(); }}
            onMouseLeave={() => { hoveredRef.current = false; resume(); }}
            onFocus={() => { focusedRef.current = true; pause(); }}
            onBlur={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                focusedRef.current = false;
                resume();
            }}
            actions={
                toastHasActions(toast) ? (
                    <ToastActionsUI toast={toast} />
                ) : undefined
            }
        />
    );
}

export interface ToastViewportUIProps {
    /**
     * Set to false when the client draws error notices itself. The web app
     * does, with `WarningPopup`; the Word add-in has no popup and keeps the
     * default.
     */
    showErrors?: boolean;
    className?: string;
}

interface Announcement {
    id: string;
    text: string;
}

/** What a toast says aloud: its title and message as plain text. */
function announcementText(toast: ToastRecord): string {
    return [toast.title, toast.message]
        .filter((part): part is string => typeof part === "string" && part !== "")
        .join(". ");
}

/**
 * The text of the newest success or info toast, for the polite live region,
 * until that toast goes. Errors announce themselves as `alert` cards.
 */
function useAnnouncement(toasts: readonly ToastRecord[]): Announcement | null {
    const [seen, setSeen] = useState<ReadonlySet<string>>(
        () => new Set(toasts.map((toast) => toast.id)),
    );
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    if (toasts.some((toast) => !seen.has(toast.id))) {
        const fresh = toasts.filter((toast) => !seen.has(toast.id));
        setSeen(new Set(toasts.map((toast) => toast.id)));
        const latest = fresh.filter((toast) => toast.tone !== "error").at(-1);
        if (latest) {
            setAnnouncement({ id: latest.id, text: announcementText(latest) });
        }
    }
    return announcement && toasts.some((toast) => toast.id === announcement.id)
        ? announcement
        : null;
}

/**
 * Renders the toast stack. Mount exactly once per client, near the root.
 * The region is always present so assistive tech registers it before the
 * first notification arrives. So is the (visually hidden) polite live region
 * after it: a success or info text is written into it as the toast is raised,
 * which screen readers announce reliably, unlike a card inserted with its
 * text.
 */
export function ToastViewportUI({
    showErrors = true,
    className,
}: ToastViewportUIProps) {
    const t = useTranslations();
    const toasts = useToasts();
    const visible = useMemo(
        () =>
            showErrors
                ? toasts
                : toasts.filter((toast) => toast.tone !== "error"),
        [showErrors, toasts],
    );
    const entries = useExitingToasts(visible);
    const announcement = useAnnouncement(toasts);

    return (
        <div
            // A landmark, not a live region: each toast announces itself
            // through its own role, and `aria-label` needs a role to be
            // exposed at all.
            role="region"
            aria-label={t("ui.toast.notifications")}
            className={twMerge(
                clsx(
                    "pointer-events-none fixed left-1/2 top-5 z-[260] flex w-[min(92vw,520px)] -translate-x-1/2 flex-col gap-2 px-4",
                ),
                className,
            )}
        >
            {/* `contents`, so popups portalled in here are flex items of
                the column and take its gap. */}
            <div ref={setNoticeStackSlot} className="contents" />
            {entries.map(({ item, leaving }) => (
                <ToastItemUI key={item.id} toast={item} leaving={leaving} />
            ))}
            <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
            >
                {announcement ? (
                    <span key={announcement.id}>{announcement.text}</span>
                ) : null}
            </div>
        </div>
    );
}
