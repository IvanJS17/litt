"use client";

import { useEffect, useState } from "react";

/** True when the person has not asked for less motion. False without matchMedia. */
function motionAllowed(): boolean {
    return (
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: no-preference)")
            .matches === true
    );
}

export interface ExitingListEntry<T> {
    item: T;
    /** True for an item that has left the list and is still being drawn, for its exit animation. */
    leaving: boolean;
}

/**
 * The list to draw: `items`, plus each item that has just left it, kept in
 * its old place for `ms` so it can animate out. With "Reduce motion" an item
 * simply goes. `items` must keep its identity between renders when nothing
 * changed (a store snapshot, or a memoised filter of one), and every item
 * needs a unique `id`.
 */
export function useExitingList<T extends { id: string }>(
    items: readonly T[],
    ms: number,
): ExitingListEntry<T>[] {
    const [previous, setPrevious] = useState(items);
    const [leaving, setLeaving] = useState<{ item: T; index: number }[]>([]);
    if (previous !== items) {
        setPrevious(items);
        const ids = new Set(items.map((item) => item.id));
        const gone = previous.flatMap((item, index) =>
            ids.has(item.id) ? [] : [{ item, index }],
        );
        if (gone.length > 0 && motionAllowed()) {
            setLeaving((current) => [
                ...current.filter(({ item }) => !ids.has(item.id)),
                ...gone,
            ]);
        }
    }
    useEffect(() => {
        if (leaving.length === 0) return;
        const timer = window.setTimeout(() => setLeaving([]), ms);
        return () => window.clearTimeout(timer);
    }, [leaving, ms]);

    const entries: ExitingListEntry<T>[] = items.map((item) => ({
        item,
        leaving: false,
    }));
    for (const { item, index } of leaving) {
        entries.splice(Math.min(index, entries.length), 0, { item, leaving: true });
    }
    return entries;
}
