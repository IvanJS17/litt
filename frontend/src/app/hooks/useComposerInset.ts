"use client";

import { useLayoutEffect, useState } from "react";

/** The floating composer sits this far above its pane's bottom (`bottom-3`). */
export const COMPOSER_BOTTOM_OFFSET = 12;
/** Space kept between the end of the thread and the composer. */
export const COMPOSER_CLEARANCE = 16;
/** Height of the fade the thread scrolls into above the composer. */
export const COMPOSER_FADE = 48;
/** The fade is already opaque this far above the composer. */
const COMPOSER_FADE_SOLID = 24;

/**
 * Measures the floating composer so the thread above it can reserve its real
 * height: the end of the thread stops above the composer, whatever the
 * composer holds (attachments, excerpts, a prompt), and text running under it
 * fades out instead of being cut by its edge.
 *
 * `minimumPadding` is the reserve used before the composer is on the page.
 */
export function useComposerInset(minimumPadding: number) {
    const [composer, setComposer] = useState<HTMLElement | null>(null);
    const [measuredHeight, setMeasuredHeight] = useState(0);
    const composerHeight = composer ? measuredHeight : 0;

    useLayoutEffect(() => {
        if (!composer) return;
        const update = () => setMeasuredHeight(composer.offsetHeight);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(composer);
        return () => observer.disconnect();
    }, [composer]);

    const reserved = composerHeight + COMPOSER_BOTTOM_OFFSET;
    return {
        /** Callback ref for the element that wraps the composer. */
        composerRef: setComposer,
        composerHeight,
        /** `padding-bottom` for the thread's scrolling content. */
        bottomPadding: Math.max(minimumPadding, reserved + COMPOSER_CLEARANCE),
        /** Height of the fade, measured from the pane's bottom edge; null
         * until the composer is measured, so the fade does not grow (and
         * shift) as it appears. */
        fadeHeight: composerHeight > 0 ? reserved + COMPOSER_FADE : null,
    };
}

/** A fade from transparent to `color`, opaque from just above the composer. */
export function composerFadeBackground(color: string) {
    return `linear-gradient(to bottom, transparent, ${color} ${COMPOSER_FADE - COMPOSER_FADE_SOLID}px)`;
}
