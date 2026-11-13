"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the person is typing on a touch screen's on-screen keyboard: the
 * main pointer is a finger (`pointer: coarse`) and no physical keyboard has
 * shown itself. An on-screen keyboard has no Shift+Enter, so the chat box
 * uses it to make Enter a line break (and the arrow sends) and to close the
 * keyboard after sending. A phone or tablet with a keyboard attached, and
 * every desktop, keep Enter to send and Shift+Enter for a line break.
 *
 * A physical keyboard shows itself by what an on-screen one cannot send: Tab,
 * Escape, an arrow, a function key, or a key held with Ctrl, Alt or Meta. The
 * first such key press turns the rule off for the rest of the visit.
 */

const COARSE = "(pointer: coarse)";

let physicalKeyboardSeen = false;
let watching = false;
const listeners = new Set<() => void>();

const PHYSICAL_ONLY_KEYS = /^(Tab|Escape|Arrow(Up|Down|Left|Right)|F\d{1,2}|Home|End|PageUp|PageDown|Insert|Delete)$/;

function watchPhysicalKeyboard() {
    if (watching) return;
    watching = true;
    window.addEventListener(
        "keydown",
        (event) => {
            if (physicalKeyboardSeen) return;
            if (
                PHYSICAL_ONLY_KEYS.test(event.key) ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey
            ) {
                physicalKeyboardSeen = true;
                for (const listener of listeners) listener();
            }
        },
        true,
    );
}

function subscribe(onChange: () => void) {
    watchPhysicalKeyboard();
    listeners.add(onChange);
    const query = window.matchMedia?.(COARSE);
    query?.addEventListener("change", onChange);
    return () => {
        listeners.delete(onChange);
        query?.removeEventListener("change", onChange);
    };
}

function getSnapshot() {
    return (
        !physicalKeyboardSeen &&
        window.matchMedia?.(COARSE).matches === true
    );
}

/** True while the on-screen keyboard is the one in use. See above. */
export function useSoftKeyboard(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** For tests: forget a physical keyboard seen earlier. */
export function resetPhysicalKeyboardForTests() {
    physicalKeyboardSeen = false;
}
