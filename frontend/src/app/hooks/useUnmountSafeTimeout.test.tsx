import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnmountSafeTimeout } from "./useUnmountSafeTimeout";

describe("useUnmountSafeTimeout", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs the callback after the delay, like setTimeout", () => {
        const fn = vi.fn();
        const { result } = renderHook(() => useUnmountSafeTimeout());
        act(() => result.current(fn, 2000));
        vi.advanceTimersByTime(1999);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps every timer it was given (a later one does not cancel an earlier one)", () => {
        const a = vi.fn();
        const b = vi.fn();
        const { result } = renderHook(() => useUnmountSafeTimeout());
        act(() => {
            result.current(a, 50);
            result.current(b, 3000);
        });
        vi.advanceTimersByTime(3000);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it("clears what is pending when the component unmounts", () => {
        const fn = vi.fn();
        const { result, unmount } = renderHook(() => useUnmountSafeTimeout());
        act(() => result.current(fn, 2000));
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(5000);
        expect(fn).not.toHaveBeenCalled();
    });
});
