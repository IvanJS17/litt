import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeChoice } from "./useThemeChoice";

type Saved = { theme: "light" | "dark" | "system" };
const { updateTheme, state } = vi.hoisted(() => ({
    updateTheme: vi.fn(),
    state: { profile: { theme: "light" } as Saved | null },
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: state.profile, updateTheme }),
}));

const saved = () => state.profile!;

beforeEach(() => {
    updateTheme.mockReset();
    updateTheme.mockResolvedValue(undefined);
    state.profile = { theme: "light" };
    vi.stubGlobal("matchMedia", undefined);
});

describe("useThemeChoice", () => {
    it("shows the saved theme, and nothing while the profile loads", () => {
        expect(renderHook(() => useThemeChoice()).result.current.theme).toBe("light");
        state.profile = null;
        expect(renderHook(() => useThemeChoice()).result.current.theme).toBeNull();
    });

    it("shows a choice at once, before the profile answers, then lets go of it", async () => {
        let finish!: () => void;
        updateTheme.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
        const { result } = renderHook(() => useThemeChoice());

        let done!: Promise<void>;
        act(() => {
            done = result.current.choose("dark");
        });
        expect(result.current.theme).toBe("dark");
        expect(result.current.saving).toBe(true);

        saved().theme = "dark";
        await act(async () => {
            finish();
            await done;
        });
        expect(result.current.saving).toBe(false);
        expect(result.current.theme).toBe("dark");
    });

    it("saves several quick choices in order, so the last one wins", async () => {
        const gates: Array<() => void> = [];
        updateTheme.mockImplementation(
            () => new Promise<void>((resolve) => gates.push(resolve)),
        );
        const { result } = renderHook(() => useThemeChoice());

        let all!: Promise<unknown>;
        act(() => {
            all = Promise.all([
                result.current.choose("dark"),
                result.current.choose("system"),
                result.current.choose("light"),
            ]);
        });
        expect(updateTheme).toHaveBeenCalledTimes(1);
        expect(updateTheme).toHaveBeenLastCalledWith("dark");
        expect(result.current.theme).toBe("light");

        await act(async () => gates.shift()!());
        await waitFor(() => expect(updateTheme).toHaveBeenCalledTimes(2));
        // The middle choice was superseded; the last one is saved.
        expect(updateTheme).toHaveBeenLastCalledWith("light");
        await act(async () => {
            gates.shift()!();
            await all;
        });
        expect(result.current.saving).toBe(false);
    });

    it("reports a failed save in plain words and drops what was queued", async () => {
        updateTheme.mockRejectedValue(new Error("pg: connection refused"));
        const { result } = renderHook(() => useThemeChoice());

        await act(async () => {
            await result.current.choose("dark");
        });
        expect(result.current.error).toBe("Could not update the appearance setting.");
        expect(result.current.error).not.toMatch(/connection refused/);
        expect(result.current.saving).toBe(false);
        expect(result.current.theme).toBe("light");

        updateTheme.mockResolvedValue(undefined);
        await act(async () => {
            await result.current.choose("dark");
        });
        expect(result.current.error).toBeNull();
    });

    it("resolves Automático with the device, for the menu's \"now:\"", async () => {
        saved().theme = "system";
        vi.stubGlobal(
            "matchMedia",
            vi.fn(() => ({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        );
        const { result } = renderHook(() => useThemeChoice());
        await waitFor(() => expect(result.current.resolved).toBe("dark"));
    });
});
