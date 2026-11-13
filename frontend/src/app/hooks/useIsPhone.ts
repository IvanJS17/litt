"use client";

import { useSyncExternalStore } from "react";

/** The width below which the sidebar is an overlay and dialogs are sheets. */
const PHONE_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
    const query = window.matchMedia?.(PHONE_QUERY);
    query?.addEventListener("change", onChange);
    return () => query?.removeEventListener("change", onChange);
}

/** True under 768 px. False while rendering on the server and hydrating. */
export function useIsPhone(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia?.(PHONE_QUERY).matches === true,
        () => false,
    );
}
