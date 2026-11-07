import { useCallback, useLayoutEffect, useState, type CSSProperties } from "react";

export type ScrollAxis = "x" | "y";

/** Whether content is hidden past either end of a scroll container. */
export interface ScrollEdges {
    /** Scrolled away from the start: content is hidden before it. */
    start: boolean;
    /** Content is hidden past the end. */
    end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

// Subpixel layouts leave a fraction of a pixel between scroll positions.
const EPSILON = 1;

export function scrollEdges(element: HTMLElement, axis: ScrollAxis): ScrollEdges {
    const offset = axis === "x" ? element.scrollLeft : element.scrollTop;
    const size = axis === "x" ? element.scrollWidth : element.scrollHeight;
    const client = axis === "x" ? element.clientWidth : element.clientHeight;
    return {
        start: offset > EPSILON,
        end: size - client - offset > EPSILON,
    };
}

/**
 * A mask that fades a vertical scroll container's content out at each end
 * that hides more, so a cut-off row reads as "there is more" rather than as
 * a clipped one.
 */
export function scrollFadeMaskStyle(
    edges: ScrollEdges,
    size = "1.5rem",
): CSSProperties | undefined {
    if (!edges.start && !edges.end) return undefined;
    const top = edges.start ? `transparent, #000 ${size}` : "#000";
    const bottom = edges.end
        ? `#000 calc(100% - ${size}), transparent`
        : "#000";
    const mask = `linear-gradient(to bottom, ${top}, ${bottom})`;
    return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * Tracks which ends of a scroll container hide content, so the surface can
 * hint at it (a fade, a shadow). Updates on scroll, when the container
 * resizes, and when its children change size.
 *
 * Attach `ref` (a callback ref, so a container that mounts later is still
 * observed) and call `onScroll` from the container's scroll handler.
 */
export function useScrollEdges<T extends HTMLElement>(axis: ScrollAxis) {
    const [element, setElement] = useState<T | null>(null);
    const [edges, setEdges] = useState<ScrollEdges>(NONE);

    const update = useCallback(() => {
        const next = element ? scrollEdges(element, axis) : NONE;
        setEdges((current) =>
            current.start === next.start && current.end === next.end
                ? current
                : next,
        );
    }, [element, axis]);

    useLayoutEffect(() => {
        const frame = requestAnimationFrame(update);
        if (!element || typeof ResizeObserver === "undefined") {
            return () => cancelAnimationFrame(frame);
        }
        const resize = new ResizeObserver(update);
        const observeChildren = () => {
            for (const child of Array.from(element.children)) {
                resize.observe(child);
            }
        };
        resize.observe(element);
        observeChildren();
        // Rows load after the container mounts; watch the new ones too.
        const mutations =
            typeof MutationObserver === "undefined"
                ? null
                : new MutationObserver(() => {
                      observeChildren();
                      update();
                  });
        mutations?.observe(element, { childList: true });
        return () => {
            cancelAnimationFrame(frame);
            resize.disconnect();
            mutations?.disconnect();
        };
    }, [element, update]);

    return { ref: setElement, edges, onScroll: update };
}
