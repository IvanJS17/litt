import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_FADE_MS, useWorkspaceFade } from "./useWorkspaceFade";

describe("useWorkspaceFade", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("fades for 150 ms when the workspace changes from one to another", () => {
        const { result, rerender } = renderHook(({ id }) => useWorkspaceFade(id), {
            initialProps: { id: "personal" as string | null },
        });
        expect(result.current).toBe(false);
        rerender({ id: "firm-1" });
        expect(result.current).toBe(true);
        act(() => {
            vi.advanceTimersByTime(WORKSPACE_FADE_MS);
        });
        expect(result.current).toBe(false);
        expect(WORKSPACE_FADE_MS).toBe(150);
    });

    it("does not fade when the workspace first becomes known", () => {
        const { result, rerender } = renderHook(({ id }) => useWorkspaceFade(id), {
            initialProps: { id: null as string | null },
        });
        rerender({ id: "personal" });
        expect(result.current).toBe(false);
    });
});
