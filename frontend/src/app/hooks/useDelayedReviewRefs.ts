"use client";

import { useEffect, useRef, useState } from "react";

/** Seconds after an answer is shown at which its citation results are read again. */
export const REVIEW_REFRESH_DELAYS_MS = [10_000, 40_000] as const;

/** The refs of the citations to check again, by the id of the row they belong to. */
export type ReviewRefsById = Readonly<Record<string, readonly number[]>>;

const NONE: ReviewRefsById = Object.freeze({});

/**
 * The automatic citation check runs after an answer, a cell or a draft is
 * saved, so its result arrives some seconds after the thing is on screen.
 * Once `trigger` becomes non-null (the answer just finished; a stable string
 * naming it) this reads the results twice, at 10 s and 40 s, with `load`, and
 * returns what it found. No polling, no sockets; a failed read is ignored (the
 * hint is an extra). A different trigger, or leaving the screen, cancels what
 * is pending and forgets what was found.
 */
export function useDelayedReviewRefs(
    trigger: string | null,
    load: () => Promise<ReviewRefsById>,
): ReviewRefsById {
    const [found, setFound] = useState<{ trigger: string; refs: ReviewRefsById } | null>(null);
    const loadRef = useRef(load);
    useEffect(() => {
        loadRef.current = load;
    });

    useEffect(() => {
        if (!trigger) return;
        let current = true;
        const timers = REVIEW_REFRESH_DELAYS_MS.map((delay) =>
            setTimeout(() => {
                void loadRef
                    .current()
                    .then((refs) => {
                        if (current) setFound({ trigger, refs });
                    })
                    .catch(() => undefined);
            }, delay),
        );
        return () => {
            current = false;
            timers.forEach(clearTimeout);
        };
    }, [trigger]);

    return found && found.trigger === trigger ? found.refs : NONE;
}
