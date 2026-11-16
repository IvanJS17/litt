import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_REFRESH_DELAYS_MS, useDelayedReviewRefs } from "./useDelayedReviewRefs";

describe("useDelayedReviewRefs", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("reads nothing without a trigger", async () => {
        const load = vi.fn().mockResolvedValue({});
        renderHook(() => useDelayedReviewRefs(null, load));
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(load).not.toHaveBeenCalled();
    });

    it("reads exactly twice after the trigger, then stops", async () => {
        const load = vi.fn().mockResolvedValue({ a1: [2] });
        const { result } = renderHook(() => useDelayedReviewRefs("turn-1", load));
        expect(result.current).toEqual({});
        await act(() => vi.advanceTimersByTimeAsync(REVIEW_REFRESH_DELAYS_MS[0]));
        expect(load).toHaveBeenCalledTimes(1);
        expect(result.current).toEqual({ a1: [2] });
        await act(() => vi.advanceTimersByTimeAsync(REVIEW_REFRESH_DELAYS_MS[1]));
        expect(load).toHaveBeenCalledTimes(2);
        await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("ignores a failed read and cancels on a new trigger", async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ b: [1] });
        const { result, rerender } = renderHook(({ t }) => useDelayedReviewRefs(t, load), {
            initialProps: { t: "turn-1" as string | null },
        });
        await act(() => vi.advanceTimersByTimeAsync(REVIEW_REFRESH_DELAYS_MS[0]));
        expect(result.current).toEqual({});
        rerender({ t: "turn-2" });
        await act(() => vi.advanceTimersByTimeAsync(REVIEW_REFRESH_DELAYS_MS[0]));
        expect(result.current).toEqual({ b: [1] });
        rerender({ t: null });
        expect(result.current).toEqual({});
    });
});
