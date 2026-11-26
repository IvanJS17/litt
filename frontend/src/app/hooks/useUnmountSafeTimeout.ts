import { useCallback, useEffect, useRef } from "react";

/**
 * `later(fn, ms)` runs `fn` after `ms`, like `setTimeout`, unless the
 * component has unmounted by then: its pending timers are cleared on unmount,
 * and a call made after the unmount (a caller that awaited a request first)
 * schedules nothing.
 * For a timer that only changes the component's own state ("Saved" going back
 * to nothing, "Copied" going back to the icon), which must not outlive it.
 */
export function useUnmountSafeTimeout(): (fn: () => void, ms: number) => void {
    const pending = useRef(new Set<ReturnType<typeof setTimeout>>());
    const mounted = useRef(true);

    useEffect(() => {
        const timers = pending.current;
        // Set again here: React's development double mount runs this effect,
        // its cleanup and then the effect once more.
        mounted.current = true;
        return () => {
            mounted.current = false;
            timers.forEach((timer) => clearTimeout(timer));
            timers.clear();
        };
    }, []);

    return useCallback((fn: () => void, ms: number) => {
        if (!mounted.current) return;
        const timer = setTimeout(() => {
            pending.current.delete(timer);
            fn();
        }, ms);
        pending.current.add(timer);
    }, []);
}
