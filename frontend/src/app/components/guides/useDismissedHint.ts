"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/app/contexts/AuthContext";

/**
 * First-time hints are remembered per person on this device: the key is
 * `litt:guide-hint:<user id>:<hint>` in localStorage. No server field and no
 * telemetry: nothing records who closed which hint. (A hint can come back on
 * another device; it is only a nudge, never a gate.)
 */
const PREFIX = "litt:guide-hint:";
const listeners = new Set<() => void>();

export function hintStorageKey(userId: string, hint: string): string {
    return `${PREFIX}${userId}:${hint}`;
}

function read(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

export function useDismissedHint(hint: string): { ready: boolean; dismissed: boolean; dismiss: () => void } {
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const key = userId ? hintStorageKey(userId, hint) : null;
    const dismissed = useSyncExternalStore(
        (notify) => {
            listeners.add(notify);
            return () => {
                listeners.delete(notify);
            };
        },
        () => (key ? read(key) : true),
        () => true,
    );
    const dismiss = useCallback(() => {
        if (!key) return;
        try {
            window.localStorage.setItem(key, "1");
        } catch {
            // Storage blocked: the hint closes for this visit only.
        }
        listeners.forEach((notify) => notify());
    }, [key]);
    return { ready: key !== null, dismissed, dismiss };
}
