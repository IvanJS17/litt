"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { isTheme, THEME_STORAGE_KEY, applyTheme, type Theme } from "@/app/lib/theme";
import { DEFAULT_THEME } from "@mike/client";

/**
 * The theme of the public start page. A visitor has no profile, so the choice
 * lives where the app's boot script already reads it: `litt:theme`
 * (lib/theme.ts), as `light`, `dark` or `system`. The page and the app share
 * that one preference on a device.
 *
 * `applyTheme` paints the page and, for `system`, follows the device live.
 */

const listeners = new Set<() => void>();

function readPreference(): Theme {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        return isTheme(stored) ? stored : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
    };
}

/** Switch themes without a transition: one class, off again after two frames. */
function withoutTransitions(change: () => void): void {
    const root = document.documentElement;
    root.classList.add("landing-no-transitions");
    change();
    requestAnimationFrame(() =>
        requestAnimationFrame(() => root.classList.remove("landing-no-transitions")),
    );
}

export function chooseTheme(theme: Theme): void {
    withoutTransitions(() => applyTheme(theme));
    listeners.forEach((listener) => listener());
}

/** What the person picked (the server cannot know, so it says Automático). */
export function useThemePreference(): { preference: Theme; choose: (theme: Theme) => void } {
    const preference = useSyncExternalStore(subscribe, readPreference, () => DEFAULT_THEME);
    // The boot script paints the first frame; this starts the live follow of
    // the device for Automático, which only `applyTheme` sets up.
    useEffect(() => {
        if (readPreference() === "system") applyTheme("system");
    }, []);
    // The server drew the pill on Automático; when the device has another
    // choice the pill moves to it on this first client render. Do that move
    // with transitions off, so it is not seen sliding from Automático.
    useLayoutEffect(() => {
        if (readPreference() !== DEFAULT_THEME) withoutTransitions(() => undefined);
    }, []);
    return { preference, choose: chooseTheme };
}

function subscribeToRootClass(listener: () => void): () => void {
    const observer = new MutationObserver(listener);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
}

/** Is the page drawn dark right now (the resolved theme, whatever the preference)? */
export function useIsDark(): boolean {
    return useSyncExternalStore(
        subscribeToRootClass,
        () => document.documentElement.classList.contains("dark"),
        () => false,
    );
}
