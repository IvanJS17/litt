"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MAIN_ID, SKIP_LINK_ID } from "./landingConstants";

/** The panel leaves in 160 ms (SPEC v2 §2.3); the timer waits a little longer. */
const CLOSE_MS = 170;
const DESKTOP_QUERY = "(min-width: 880px)";
const OPEN_CLASS = "menu-open";

export type CloseOptions = {
    /** Hide the panel now instead of after its exit transition. */
    instant?: boolean;
    /** Put the focus back on the menu button. */
    restoreFocus?: boolean;
};

export type MobileMenu = {
    /** `aria-expanded` of the button: the menu is, or is becoming, visible. */
    open: boolean;
    /** The panel is not `hidden` (true while it is leaving, too). */
    shown: boolean;
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    panelRef: React.RefObject<HTMLElement | null>;
    firstLinkRef: React.RefObject<HTMLAnchorElement | null>;
    toggle: () => void;
    close: (options?: CloseOptions) => void;
    /** A link to a section: close at once, go there, and put the focus on its heading. */
    goToSection: (event: React.MouseEvent<HTMLAnchorElement>, id: string) => void;
};

function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** What the page shows behind the menu: not reachable by Tab, mouse or reader while it is open. */
function pageBehind(): HTMLElement[] {
    const root = document.querySelector<HTMLElement>(".landing-root");
    return [
        document.getElementById(SKIP_LINK_ID),
        document.getElementById(MAIN_ID),
        root?.querySelector<HTMLElement>(":scope > footer") ?? null,
    ].filter((el): el is HTMLElement => el !== null);
}

/**
 * The state and the behavior of the phone menu (SPEC v2 §2.3). It is a
 * disclosure, not a dialog: the button stays outside the panel and keeps
 * working. While it is open the page behind is `inert`, the page does not
 * scroll (the app-wide `react-remove-scroll` on the panel, plus `overflow:
 * hidden` on `<html>` through the `menu-open` class), Tab cycles between the
 * button and the panel, and Esc, the backdrop, a link, a wider window, history
 * and `pagehide` close it.
 *
 * The header's own controls (wordmark, theme button, docked button) are made
 * inert by `LandingHeader`, from `open`; the elements this hook finds in the
 * DOM are the ones the header does not render.
 */
export function useMobileMenu(): MobileMenu {
    const [open, setOpen] = useState(false);
    const [shown, setShown] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLElement | null>(null);
    const firstLinkRef = useRef<HTMLAnchorElement | null>(null);
    const isOpen = useRef(false);
    const timer = useRef<number | undefined>(undefined);

    const close = useCallback((options: CloseOptions = {}) => {
        if (!isOpen.current) return;
        isOpen.current = false;
        document.documentElement.classList.remove(OPEN_CLASS);
        pageBehind().forEach((el) => el.removeAttribute("inert"));
        const instant = options.instant || prefersReducedMotion();
        flushSync(() => {
            setOpen(false);
            if (instant) setShown(false);
        });
        if (!instant) {
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
                if (!isOpen.current) setShown(false);
            }, CLOSE_MS);
        }
        if (options.restoreFocus) buttonRef.current?.focus({ preventScroll: true });
    }, []);

    const openMenu = useCallback(() => {
        if (isOpen.current) return;
        window.clearTimeout(timer.current);
        isOpen.current = true;
        // The panel is drawn closed first, so the class below can make it travel.
        flushSync(() => {
            setShown(true);
            setOpen(true);
        });
        void panelRef.current?.offsetWidth;
        document.documentElement.classList.add(OPEN_CLASS);
        pageBehind().forEach((el) => el.setAttribute("inert", ""));
        firstLinkRef.current?.focus({ preventScroll: true });
    }, []);

    const toggle = useCallback(() => {
        if (isOpen.current) close({ restoreFocus: true });
        else openMenu();
    }, [close, openMenu]);

    const goToSection = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
            const target = document.getElementById(id);
            if (!target) return; // let the browser follow the hash
            event.preventDefault();
            close({ instant: true });
            window.history.pushState(null, "", `#${id}`);
            target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
            target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
        },
        [close],
    );

    useEffect(() => {
        function focusables(): HTMLElement[] {
            const inPanel = panelRef.current?.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), [tabindex="0"]',
            );
            return [buttonRef.current, ...(inPanel ?? [])].filter(
                (el): el is HTMLElement => el !== null && el.tabIndex >= 0 && el.closest("[hidden]") === null,
            );
        }

        // Esc, and Tab kept inside: `inert` keeps the focus off the page, and this
        // loop keeps it from leaving for the browser's own bar.
        function onKeyDown(event: KeyboardEvent) {
            if (!isOpen.current) return;
            if (event.key === "Escape") {
                event.preventDefault();
                close({ restoreFocus: true });
                return;
            }
            if (event.key !== "Tab") return;
            const items = focusables();
            const first = items[0];
            const last = items[items.length - 1];
            if (!first || !last) return;
            const current = document.activeElement as HTMLElement | null;
            if (event.shiftKey && current === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && current === last) {
                event.preventDefault();
                first.focus();
            } else if (!current || !items.includes(current)) {
                event.preventDefault();
                first.focus();
            }
        }

        const desktop = window.matchMedia?.(DESKTOP_QUERY);
        const onWide = (event: MediaQueryListEvent) => {
            if (event.matches) close({ instant: true });
        };
        const onLeave = () => close({ instant: true });

        document.addEventListener("keydown", onKeyDown);
        desktop?.addEventListener?.("change", onWide);
        window.addEventListener("popstate", onLeave);
        window.addEventListener("pagehide", onLeave);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            desktop?.removeEventListener?.("change", onWide);
            window.removeEventListener("popstate", onLeave);
            window.removeEventListener("pagehide", onLeave);
            window.clearTimeout(timer.current);
            // Leaving the page (a link, the router) with the menu open leaves nothing behind.
            document.documentElement.classList.remove(OPEN_CLASS);
            pageBehind().forEach((el) => el.removeAttribute("inert"));
            isOpen.current = false;
        };
    }, [close]);

    return { open, shown, buttonRef, panelRef, firstLinkRef, toggle, close, goToSection };
}
