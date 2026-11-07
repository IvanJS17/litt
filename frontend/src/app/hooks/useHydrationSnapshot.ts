import { useMemo, useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Answers `serverSnapshot(value)` while this component hydrates and `value`
 * afterwards. A provider can settle (the session or profile request) before a
 * streamed or lazily loaded boundary below it hydrates; that boundary must
 * still render what the server rendered, or React throws away its HTML with a
 * hydration error. Outside hydration (a client navigation) `value` comes back
 * at once. React re-renders the component with `value` right after hydrating.
 * Pass a module-level `serverSnapshot` so the memo holds between renders.
 */
export function useHydrationSnapshot<T>(
    value: T,
    serverSnapshot: (value: T) => T,
): T {
    const hydrating = useSyncExternalStore(
        subscribe,
        () => false,
        () => true,
    );
    const snapshot = useMemo(
        () => (hydrating ? serverSnapshot(value) : value),
        [hydrating, value, serverSnapshot],
    );
    return snapshot;
}
