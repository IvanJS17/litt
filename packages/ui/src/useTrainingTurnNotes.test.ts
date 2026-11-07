import { act, renderHook } from "@testing-library/react";
import type { TrainingTurnNote } from "@mike/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    TRAINING_NOTES_POLL_MAX_MS,
    TRAINING_NOTES_POLL_MS,
    matchTrainingNotes,
    useTrainingTurnNotes,
} from "./useTrainingTurnNotes";

const getTrainingTurnNotes = vi.fn();

const note = (
    id: string,
    message_id: string,
    status: TrainingTurnNote["contrast_status"] = "ready",
    created_at = `2026-01-01T00:00:0${id.slice(1)}Z`,
    attempt = "a",
): TrainingTurnNote => ({
    id,
    org_id: "o",
    trainee_user_id: "u",
    chat_id: "c1",
    message_id,
    attempt,
    contrast: status === "ready" ? "Coincide" : null,
    contrast_status: status,
    created_at,
});

describe("matchTrainingNotes", () => {
    it("matches saved messages by id and ignores assistants", () => {
        const matched = matchTrainingNotes(
            [
                { id: "m1", role: "user" },
                { id: "m2", role: "assistant" },
                { id: "m3", role: "user" },
            ],
            [note("n1", "m1")],
        );
        expect([...matched.keys()]).toEqual([0]);
    });

    it("gives a just-sent message the unclaimed note with its exact attempt", () => {
        const matched = matchTrainingNotes(
            [
                { id: "m1", role: "user" },
                { role: "user", attempt: "x" },
                { role: "user", attempt: " y " },
                { role: "user" },
            ],
            [
                note("n3", "m9", "ready", undefined, "y"),
                note("n1", "m1"),
                note("n2", "m8", "ready", undefined, "x"),
            ],
        );
        expect(matched.get(0)?.id).toBe("n1");
        expect(matched.get(1)?.id).toBe("n2");
        expect(matched.get(2)?.id).toBe("n3");
        expect(matched.has(3)).toBe(false);
    });

    it("treats a just-sent message with a client id (Word) as just sent", () => {
        const matched = matchTrainingNotes(
            [
                { id: "m1", role: "user" },
                { id: "user-local-1", role: "user", attempt: "x" },
                { id: "user-local-2", role: "user" },
            ],
            [note("n1", "m1"), note("n2", "m8", "ready", undefined, "x")],
        );
        expect(matched.get(0)?.id).toBe("n1");
        expect(matched.get(1)?.id).toBe("n2");
        expect(matched.has(2)).toBe(false);
    });

    it("leaves a just-sent message bare when its note was never created", () => {
        // The newer turn's note failed: it must not borrow the older one's.
        const matched = matchTrainingNotes(
            [
                { role: "user", attempt: "x" },
                { role: "user", attempt: "y" },
            ],
            [note("n1", "m9", "ready", undefined, "x")],
        );
        expect([...matched.keys()]).toEqual([0]);
        expect(matched.get(0)?.id).toBe("n1");
    });

    it("pairs identical attempts newest with newest", () => {
        const matched = matchTrainingNotes(
            [
                { role: "user", attempt: "x" },
                { role: "user", attempt: "x" },
            ],
            [
                note("n2", "m8", "ready", undefined, "x"),
                note("n1", "m9", "ready", undefined, "x"),
            ],
        );
        expect(matched.get(0)?.id).toBe("n1");
        expect(matched.get(1)?.id).toBe("n2");
    });

    it("is empty without notes", () => {
        expect(matchTrainingNotes([{ role: "user", id: "m1" }], []).size).toBe(0);
    });
});

describe("useTrainingTurnNotes", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        getTrainingTurnNotes.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it("reads nothing without a chat or while a response streams", () => {
        const { result, rerender } = renderHook(
            ({ id, loading }) => useTrainingTurnNotes(id, loading, getTrainingTurnNotes),
            { initialProps: { id: undefined as string | undefined, loading: false } },
        );
        rerender({ id: "c1", loading: true });
        expect(getTrainingTurnNotes).not.toHaveBeenCalled();
        expect(result.current).toEqual([]);
    });

    it("loads once when nothing is pending and drops them when the chat changes", async () => {
        getTrainingTurnNotes.mockResolvedValue([note("n1", "m1")]);
        const { result, rerender } = renderHook(
            ({ id }) => useTrainingTurnNotes(id, false, getTrainingTurnNotes),
            { initialProps: { id: "c1" } },
        );
        await act(async () => {});
        expect(result.current).toHaveLength(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TRAINING_NOTES_POLL_MS * 3);
        });
        expect(getTrainingTurnNotes).toHaveBeenCalledTimes(1);
        rerender({ id: "c2" });
        expect(result.current).toEqual([]);
    });

    it("shows no notes, without throwing, when the answer is not a list", async () => {
        getTrainingTurnNotes.mockResolvedValue(undefined);
        const { result } = renderHook(() => useTrainingTurnNotes("c1", false, getTrainingTurnNotes));
        await act(async () => {});
        expect(result.current).toEqual([]);
    });

    it("polls every 5 s while pending, then stops once ready", async () => {
        getTrainingTurnNotes
            .mockResolvedValueOnce([note("n1", "m1", "pending")])
            .mockResolvedValueOnce([note("n1", "m1", "ready")]);
        const { result } = renderHook(() => useTrainingTurnNotes("c1", false, getTrainingTurnNotes));
        await act(async () => {});
        expect(result.current[0].contrast_status).toBe("pending");
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TRAINING_NOTES_POLL_MS);
        });
        expect(result.current[0].contrast_status).toBe("ready");
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TRAINING_NOTES_POLL_MS * 4);
        });
        expect(getTrainingTurnNotes).toHaveBeenCalledTimes(2);
    });

    it("gives up after two minutes", async () => {
        getTrainingTurnNotes.mockResolvedValue([
            note("n1", "m1", "pending"),
        ]);
        renderHook(() => useTrainingTurnNotes("c1", false, getTrainingTurnNotes));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TRAINING_NOTES_POLL_MAX_MS * 2);
        });
        expect(getTrainingTurnNotes.mock.calls.length).toBe(
            TRAINING_NOTES_POLL_MAX_MS / TRAINING_NOTES_POLL_MS + 1,
        );
    });

    it("cancels the poll on unmount and ignores a late reply", async () => {
        let resolve!: (n: TrainingTurnNote[]) => void;
        getTrainingTurnNotes.mockReturnValueOnce(
            new Promise((r) => (resolve = r)),
        );
        const { unmount } = renderHook(() => useTrainingTurnNotes("c1", false, getTrainingTurnNotes));
        unmount();
        await act(async () => resolve([note("n1", "m1", "pending")]));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TRAINING_NOTES_POLL_MS * 2);
        });
        expect(getTrainingTurnNotes).toHaveBeenCalledTimes(1);
    });

    it("clears a scheduled poll on unmount", async () => {
        getTrainingTurnNotes.mockResolvedValue([
            note("n1", "m1", "pending"),
        ]);
        const { unmount } = renderHook(() => useTrainingTurnNotes("c1", false, getTrainingTurnNotes));
        await act(async () => {});
        unmount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(TRAINING_NOTES_POLL_MS * 2);
        });
        expect(getTrainingTurnNotes).toHaveBeenCalledTimes(1);
    });

    it("keeps quiet when the read fails", async () => {
        getTrainingTurnNotes.mockRejectedValue(new Error("down"));
        const { result } = renderHook(() => useTrainingTurnNotes("c1", false, getTrainingTurnNotes));
        await act(async () => {});
        expect(result.current).toEqual([]);
    });
});
