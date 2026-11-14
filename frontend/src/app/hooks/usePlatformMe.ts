"use client";

import { useCallback, useEffect, useState } from "react";
import { clientTranslator } from "@mike/client";
import { getPlatformMe, type PlatformMe } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/**
 * What the invite-only beta lets the signed-in person do. One request per
 * person, shared by every caller (the Settings tabs and the Organizations
 * page), and started with the profile when the session starts, so the beta
 * tabs are there with all the others instead of arriving later.
 */

/** A reading stays good this long; creating an organization changes it. */
const FRESH_MS = 30_000;
/** Waits before the retries after a failed read. */
const RETRY_DELAYS_MS = [750, 2_000];

type Entry = { promise: Promise<PlatformMe>; settledAt: number | null };
const entries = new Map<string, Entry>();

async function readWithRetries(): Promise<PlatformMe> {
    for (const delay of RETRY_DELAYS_MS) {
        try {
            return await getPlatformMe();
        } catch {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    return getPlatformMe();
}

/** The shared reading for a person: reuses one in flight or a fresh one. */
export function loadPlatformMe(userId: string): Promise<PlatformMe> {
    const existing = entries.get(userId);
    if (
        existing &&
        (existing.settledAt === null || Date.now() - existing.settledAt < FRESH_MS)
    ) {
        return existing.promise;
    }
    const entry: Entry = { promise: readWithRetries(), settledAt: null };
    entries.set(userId, entry);
    entry.promise.then(
        () => {
            entry.settledAt = Date.now();
        },
        () => {
            // A failure is never kept: the next caller asks again.
            if (entries.get(userId) === entry) entries.delete(userId);
        },
    );
    return entry.promise;
}

/** Starts the reading without waiting for it (called with the profile load). */
export function prefetchPlatformMe(userId: string): void {
    loadPlatformMe(userId).catch(() => {});
}

/** Forgets what was read, e.g. after the person creates an organization. */
export function invalidatePlatformMe(): void {
    entries.clear();
}

export type PlatformMeState =
    | { status: "loading"; me: null }
    | { status: "ready"; me: PlatformMe }
    | { status: "failed"; me: null };

/**
 * `loading` until the answer arrives, then `ready`. If the read still fails
 * after its retries the state is `failed`: a notice offers Retry, and the
 * callers hide only what needs a definite answer (the server enforces the
 * rules either way). Nothing is read without a person to read it for.
 */
export function usePlatformMe(userId?: string | undefined): PlatformMeState {
    const [result, setResult] = useState<{ userId: string; state: PlatformMeState } | null>(
        null,
    );
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((count) => count + 1), []);

    useEffect(() => {
        if (!userId) return;
        let disposed = false;
        loadPlatformMe(userId).then(
            (me) => {
                if (!disposed) setResult({ userId, state: { status: "ready", me } });
            },
            (error) => {
                if (disposed) return;
                setResult({ userId, state: { status: "failed", me: null } });
                notifyError(error, {
                    action: clientTranslator()("errors.action.loadYourSettingsTabs"),
                    dedupeKey: "platform-me",
                    onRetry: retry,
                });
            },
        );
        return () => {
            disposed = true;
        };
    }, [userId, attempt, retry]);

    if (!userId) return { status: "failed", me: null };
    return result?.userId === userId ? result.state : { status: "loading", me: null };
}
