import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    COMPOSER_BOTTOM_OFFSET,
    COMPOSER_CLEARANCE,
    COMPOSER_FADE,
    useComposerInset,
} from "./useComposerInset";

let resize: (() => void) | undefined;
class FakeResizeObserver {
    constructor(callback: () => void) {
        resize = callback;
    }
    observe() {}
    disconnect() {}
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
});
