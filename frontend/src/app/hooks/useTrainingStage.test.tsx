import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrainingStage } from "@/app/lib/mikeApi";
import { markTrainingStageStale, useTrainingStage } from "./useTrainingStage";

vi.mock("@/app/lib/mikeApi", () => ({ getTrainingStage: vi.fn() }));

const answer = (
    attemptRequired: boolean,
    expiresAt: string | null = null,
    confidenceRequired: boolean | null = attemptRequired,
) => ({
    stage: "pasante" as const,
    attempt_required: attemptRequired,
    // null: a server older than layer 3, which sends no such field.
    ...(confidenceRequired === null ? {} : { confidence_required: confidenceRequired }),
    urgency_pass: expiresAt ? { project_id: "p1", expires_at: expiresAt } : null,
});

const NO_MODES = { modes: [], nextHintLevel: null, counterpartNextStep: null };

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
            expect(result.current).toEqual({ attemptRequired: false, confidenceRequired: false, urgencyPassExpiresAt: end, stage: "pasante", ...NO_MODES }),
        );
        expect(getTrainingStage).toHaveBeenCalledWith({ orgId: "o1", projectId: "p1", chatId: null });
    });

    it("follows confidence_required for the thermometer, and a server older than layer 3 asks for no mark", async () => {
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(true, null, null));
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1" }));
        await waitFor(() => expect(result.current.attemptRequired).toBe(true));
        expect(result.current.confidenceRequired).toBe(false);
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(true, null, true));
        act(() => markTrainingStageStale());
        await waitFor(() => expect(result.current.confidenceRequired).toBe(true));
    });

    it("asks nothing while disabled or outside an organization", () => {
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1", enabled: false }));
        expect(result.current).toEqual({ attemptRequired: false, confidenceRequired: false, urgencyPassExpiresAt: null, stage: null, ...NO_MODES });
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
        expect(result.current).toEqual({ attemptRequired: false, confidenceRequired: false, urgencyPassExpiresAt: null, stage: null, ...NO_MODES });
    });

    it("reads again when a turn was refused for a missing approach", async () => {
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(false, new Date(Date.now() + 3_600_000).toISOString()));
        const { result } = renderHook(() => useTrainingStage({ orgId: "o1", projectId: "p1" }));
        await waitFor(() => expect(result.current.urgencyPassExpiresAt).not.toBeNull());
        vi.mocked(getTrainingStage).mockResolvedValueOnce(answer(true));
        act(() => markTrainingStageStale());
        await waitFor(() =>
            expect(result.current).toEqual({ attemptRequired: true, confidenceRequired: true, urgencyPassExpiresAt: null, stage: "pasante", ...NO_MODES }),
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

    describe("hints and the counterparty's lawyer", () => {
        const withModes = () => ({
            ...answer(true),
            modes: ["hint", "counterpart"] as ("hint" | "counterpart")[],
            next_hint_level: 2 as 1 | 2 | 3,
            counterpart_next_step: 1 as 1 | 2 | 3,
        });

        it("asks for the chat's modes and says what the server counted", async () => {
            vi.mocked(getTrainingStage).mockResolvedValue(withModes());
            const { result } = renderHook(() =>
                useTrainingStage({ orgId: "o1", projectId: "p1", chatId: "c1" }),
            );
            await waitFor(() => expect(result.current.modes).toEqual(["hint", "counterpart"]));
            expect(result.current.nextHintLevel).toBe(2);
            expect(result.current.counterpartNextStep).toBe(1);
            expect(getTrainingStage).toHaveBeenCalledWith({ orgId: "o1", projectId: "p1", chatId: "c1" });
        });

        it("offers no mode from a server older than hints", async () => {
            vi.mocked(getTrainingStage).mockResolvedValue(answer(true));
            const { result } = renderHook(() =>
                useTrainingStage({ orgId: "o1", projectId: "p1", chatId: "c1" }),
            );
            await waitFor(() => expect(result.current.attemptRequired).toBe(true));
            expect(result.current).toMatchObject(NO_MODES);
        });

        it("reads the ladder again when the turn ends, not while it runs", async () => {
            vi.mocked(getTrainingStage).mockResolvedValueOnce(withModes());
            const { result, rerender } = renderHook(
                ({ turnActive }) =>
                    useTrainingStage({ orgId: "o1", projectId: "p1", chatId: "c1", turnActive }),
                { initialProps: { turnActive: false } },
            );
            await waitFor(() => expect(result.current.nextHintLevel).toBe(2));
            rerender({ turnActive: true });
            expect(getTrainingStage).toHaveBeenCalledTimes(1);
            vi.mocked(getTrainingStage).mockResolvedValueOnce({
                ...withModes(),
                next_hint_level: 3,
            });
            rerender({ turnActive: false });
            await waitFor(() => expect(result.current.nextHintLevel).toBe(3));
            expect(getTrainingStage).toHaveBeenCalledTimes(2);
        });

        it("keeps the approach on screen while a new chat gets its id, and hides modes counted for another chat", async () => {
            vi.mocked(getTrainingStage).mockResolvedValueOnce(withModes());
            const { result, rerender } = renderHook(
                ({ chatId }: { chatId: string | null }) =>
                    useTrainingStage({ orgId: "o1", projectId: "p1", chatId }),
                { initialProps: { chatId: "c1" as string | null } },
            );
            await waitFor(() => expect(result.current.modes).toHaveLength(2));
            let release: (value: ReturnType<typeof withModes>) => void = () => {};
            vi.mocked(getTrainingStage).mockImplementationOnce(
                () => new Promise((resolve) => (release = resolve)) as never,
            );
            rerender({ chatId: "c2" });
            expect(result.current.attemptRequired).toBe(true);
            expect(result.current.modes).toEqual([]);
            expect(result.current.nextHintLevel).toBeNull();
            await act(async () => release({ ...withModes(), next_hint_level: 1 }));
            await waitFor(() => expect(result.current.nextHintLevel).toBe(1));
        });
    });
});
