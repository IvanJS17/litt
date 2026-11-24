import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    COMPOSER_BOTTOM_OFFSET,
    COMPOSER_CLEARANCE,
    COMPOSER_FADE,
    composerFadeBackground,
    useComposerInset,
} from "./useComposerInset";

let resize: (() => void) | undefined;
const observed: Element[] = [];
const disconnect = vi.fn();
class FakeResizeObserver {
    constructor(callback: () => void) {
        resize = callback;
    }
    observe(element: Element) {
        observed.push(element);
    }
    disconnect = disconnect;
}

function composer(height: number) {
    const element = document.createElement("div");
    let current = height;
    Object.defineProperty(element, "offsetHeight", { get: () => current });
    return {
        element,
        grow(next: number) {
            current = next;
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    resize = undefined;
    observed.length = 0;
    disconnect.mockReset();
});

describe("useComposerInset", () => {
    it("keeps the minimum reserve until the composer is on the page", () => {
        const { result } = renderHook(() => useComposerInset(116));
        expect(result.current.composerHeight).toBe(0);
        expect(result.current.bottomPadding).toBe(116);
        // No fade yet: it would grow, and shift, once the composer is measured.
        expect(result.current.fadeHeight).toBeNull();
    });

    it("keeps the end of the thread above a composer of any height", () => {
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        const { result } = renderHook(() => useComposerInset(116));
        const box = composer(94);
        act(() => result.current.composerRef(box.element));

        // The reserve is the composer's real height, not the old fixed 116.
        expect(result.current.bottomPadding).toBe(
            94 + COMPOSER_BOTTOM_OFFSET + COMPOSER_CLEARANCE,
        );

        // Attachments and a prompt make it taller; the reserve follows.
        box.grow(260);
        act(() => resize?.());
        expect(result.current.bottomPadding).toBe(
            260 + COMPOSER_BOTTOM_OFFSET + COMPOSER_CLEARANCE,
        );
        // The fade covers the composer and the strip above it.
        expect(result.current.fadeHeight).toBe(
            260 + COMPOSER_BOTTOM_OFFSET + COMPOSER_FADE,
        );
    });

    it("leaves the end of the thread clear of the fade at any composer height", () => {
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        const { result } = renderHook(() => useComposerInset(116));
        const box = composer(90);
        act(() => result.current.composerRef(box.element));

        for (const height of [90, 138, 260]) {
            box.grow(height);
            act(() => resize?.());
            const aboveComposer =
                result.current.bottomPadding -
                (height + COMPOSER_BOTTOM_OFFSET);
            const fadeAboveComposer =
                (result.current.fadeHeight ?? 0) -
                (height + COMPOSER_BOTTOM_OFFSET);
            // The last line rests at the end of the scroll: the fade must not
            // start below it, or its last lines are washed out for good.
            expect(fadeAboveComposer).toBe(COMPOSER_FADE);
            expect(aboveComposer).toBeGreaterThanOrEqual(fadeAboveComposer);
        }
    });

    it("fades to the colour only where the composer starts", () => {
        // A solid stretch above the composer would hide text that can still
        // be in view, not only text scrolled under the composer.
        expect(composerFadeBackground("red")).toBe(
            `linear-gradient(to bottom, transparent, red ${COMPOSER_FADE}px)`,
        );
    });

    it("stops observing the composer when it unmounts", () => {
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        const { result, unmount } = renderHook(() => useComposerInset(116));
        const box = composer(94);
        act(() => result.current.composerRef(box.element));
        expect(observed).toEqual([box.element]);
        expect(disconnect).not.toHaveBeenCalled();

        unmount();

        expect(disconnect).toHaveBeenCalledTimes(1);
    });
});
