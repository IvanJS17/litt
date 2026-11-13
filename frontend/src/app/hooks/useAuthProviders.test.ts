import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAuthProviders } from "./useAuthProviders";

type Providers = { sso: boolean; google: boolean | null; inviteOnly?: boolean };

const { getAuthProviders } = vi.hoisted(() => ({
    getAuthProviders: vi.fn<() => Promise<Providers>>(),
}));
vi.mock("@/app/lib/authApi", () => ({ getAuthProviders }));

function deferred() {
    let resolve!: (value: Providers) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<Providers>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("useAuthProviders", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        getAuthProviders.mockReset();
    });

    it("offers no external route while the answer is pending", () => {
        getAuthProviders.mockReturnValue(new Promise(() => {}));
        const { result } = renderHook(() => useAuthProviders());
        expect(result.current).toEqual({ showSso: false, showGoogle: false, inviteOnly: null });
    });

    it.each([
        [{ sso: false, google: false }, { showSso: false, showGoogle: false, inviteOnly: false }],
        [{ sso: true, google: false }, { showSso: true, showGoogle: false, inviteOnly: false }],
        [{ sso: false, google: true }, { showSso: false, showGoogle: true, inviteOnly: false }],
        [{ sso: true, google: null }, { showSso: true, showGoogle: true, inviteOnly: false }],
    ])("hides only what the server says is off: %o", async (answer, shown) => {
        getAuthProviders.mockResolvedValue(answer);
        const { result } = renderHook(() => useAuthProviders());
        await act(async () => {});
        expect(result.current).toEqual(shown);
    });

    it("reports the closed beta only when the server says so", async () => {
        getAuthProviders.mockResolvedValue({ sso: false, google: true, inviteOnly: true });
        const { result } = renderHook(() => useAuthProviders());
        await act(async () => {});
        expect(result.current.inviteOnly).toBe(true);
    });

    it("offers both routes when the read fails, and says nothing about sign-up", async () => {
        getAuthProviders.mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderHook(() => useAuthProviders());
        await act(async () => {});
        expect(result.current).toEqual({ showSso: true, showGoogle: true, inviteOnly: null });
    });

    it.each([
        ["answers", (d: ReturnType<typeof deferred>) => d.resolve({ sso: true, google: true })],
        ["fails", (d: ReturnType<typeof deferred>) => d.reject(new TypeError("Failed to fetch"))],
    ])("ignores an answer that %s after unmount", async (_label, settle) => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const pending = deferred();
        getAuthProviders.mockReturnValue(pending.promise);
        const { result, unmount } = renderHook(() => useAuthProviders());
        unmount();
        await act(async () => settle(pending));
        expect(result.current).toEqual({ showSso: false, showGoogle: false, inviteOnly: null });
        expect(error).not.toHaveBeenCalled();
    });
});
