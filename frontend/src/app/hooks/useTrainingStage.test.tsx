import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrainingStage } from "@/app/lib/mikeApi";
import { markTrainingStageStale, useTrainingStage } from "./useTrainingStage";

vi.mock("@/app/lib/mikeApi", () => ({ getTrainingStage: vi.fn() }));

const answer = (attemptRequired: boolean, expiresAt: string | null = null) => ({
    stage: "pasante" as const,
    attempt_required: attemptRequired,
    urgency_pass: expiresAt ? { project_id: "p1", expires_at: expiresAt } : null,
});

describe("useTrainingStage", () => {
    beforeEach(() => {
        vi.mocked(getTrainingStage).mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it("follows attempt_required, not the stage: a pass in force lifts the field", async () => {
        const end = new Date(Date.now() + 3_600_000).toISOString();
        vi.mocked(getTrainingStage).mockResolvedValue(answer(false, end));
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1" }));
        await waitFor(() =>
            expect(result.current).toEqual({ attemptRequired: false, urgencyPassExpiresAt: end }),
        );
        expect(getTrainingStage).toHaveBeenCalledWith({ orgId: "o1", projectId: "p1" });
    });

    it("asks nothing while disabled or outside an organization", () => {
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1", enabled: false }));
        expect(result.current).toEqual({ attemptRequired: false, urgencyPassExpiresAt: null });
        renderHook(() => useTrainingStage({ orgId: null, projectId: null }));
        expect(getTrainingStage).not.toHaveBeenCalled();
    });

    it("asks nothing when the stage cannot be read: the server's 400 still asks", async () => {
        vi.mocked(getTrainingStage).mockImplementation(async () => {
            throw new Error("down");
        });
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1" }));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
        expect(getTrainingStage).toHaveBeenCalledTimes(1);
        expect(result.current).toEqual({ attemptRequired: false, urgencyPassExpiresAt: null });
    });

    it("reads again when a turn was refused for a missing approach", async () => {
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(false, new Date(Date.now() + 3_600_000).toISOString()));
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1" }));
        await waitFor(() => expect(result.current.urgencyPassExpiresAt).not.toBeNull());
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(true));
        act(() => markTrainingStageStale());
        await waitFor(() =>
            expect(result.current).toEqual({ attemptRequired: true, urgencyPassExpiresAt: null }),
        );
    });

    it("reads again once the pass ends, so the field comes back", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const end = new Date(Date.now() + 60_000).toISOString();
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(false, end));
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1" }));
        await waitFor(() => expect(result.current.urgencyPassExpiresAt).toBe(end));
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(true));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(61_500);
        });
        await waitFor(() => expect(result.current.attemptRequired).toBe(true));
        expect(getTrainingStage).toHaveBeenCalledTimes(2);
    });
});
