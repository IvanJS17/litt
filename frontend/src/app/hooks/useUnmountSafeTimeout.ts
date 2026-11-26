import { useCallback, useEffect, useRef } from "react";

/**
 * `later(fn, ms)` runs `fn` after `ms`, like `setTimeout`, unless the
 * component has unmounted by then: its pending timers are cleared on unmount.
 * For a timer that only changes the component's own state ("Saved" going back
 * to nothing, "Copied" going back to the icon), which must not outlive it.
 */
export function useUnmountSafeTimeout(): (fn: () => void, ms: number) => void {
    const pending = useRef(new Set<ReturnType<typeof setTimeout>>());

    useEffect(() => {
        const timers = pending.current;
        return () => {
            timers.forEach((timer) => clearTimeout(timer));
            timers.clear();
        };
    }, []);

    return useCallback((fn: () => void, ms: number) => {
        const timer = setTimeout(() => {
            pending.current.delete(timer);
            fn();
        }, ms);
        pending.current.add(timer);
    }, []);
}
