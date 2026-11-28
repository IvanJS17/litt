import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorageUsage } from "./useStorageUsage";

const api = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getUserStorageUsage: api.user,
    getOrgStorageUsage: api.org,
}));

beforeEach(() => vi.clearAllMocks());

describe("useStorageUsage", () => {
    it("starts loading, then holds the person's use", async () => {
        api.user.mockResolvedValue({ usedBytes: 1, limitBytes: 4 });
        const { result } = renderHook(() => useStorageUsage());
        expect(result.current.state).toEqual({ status: "loading" });
        await waitFor(() =>
            expect(result.current.state).toEqual({ status: "loaded", usage: { usedBytes: 1, limitBytes: 4 } }),
        );
        expect(api.org).not.toHaveBeenCalled();
    });

    it("reads the firm's use when it is given a firm", async () => {
        api.org.mockResolvedValue({ usedBytes: 2, limitBytes: 8 });
        const { result } = renderHook(() => useStorageUsage("org-1"));
        await waitFor(() => expect(result.current.state.status).toBe("loaded"));
        expect(api.org).toHaveBeenCalledWith("org-1", expect.any(AbortSignal));
        expect(api.user).not.toHaveBeenCalled();
    });

    it("says what failed in the person's words and offers a retry that works", async () => {
        api.user.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        api.user.mockResolvedValueOnce({ usedBytes: 3, limitBytes: 4 });
        const { result } = renderHook(() => useStorageUsage());
        await waitFor(() => expect(result.current.state.status).toBe("failed"));
        const failed = result.current.state;
        if (failed.status !== "failed") throw new Error("expected a failure");
        expect(failed.error.title).toMatch(/load the storage use/);
        expect(failed.error.message).not.toMatch(/Failed to fetch/);
        act(() => result.current.retry());
        expect(result.current.state).toEqual({ status: "loading" });
        await waitFor(() => expect(result.current.state.status).toBe("loaded"));
    });

    it("shows nothing for a read that was cancelled", async () => {
        const seen: AbortSignal[] = [];
        api.user.mockImplementation((signal: AbortSignal) => {
            seen.push(signal);
            return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));
        });
        const { result, unmount } = renderHook(() => useStorageUsage());
        unmount();
        expect(seen[0].aborted).toBe(true);
        expect(result.current.state).toEqual({ status: "loading" });
    });

    it("reads again when the firm changes", async () => {
        api.org.mockResolvedValue({ usedBytes: 1, limitBytes: 2 });
        const { rerender, result } = renderHook(({ id }) => useStorageUsage(id), { initialProps: { id: "a" } });
        await waitFor(() => expect(result.current.state.status).toBe("loaded"));
        rerender({ id: "b" });
        await waitFor(() => expect(api.org).toHaveBeenCalledWith("b", expect.any(AbortSignal)));
    });
});
