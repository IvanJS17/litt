import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingBackingCheck } from "@mike/contracts";
import {
  TRAINING_BACKING_POLL_MAX_MS,
  TRAINING_BACKING_POLL_MS,
  useTrainingBacking,
} from "./useTrainingBacking";

const check = (over: Partial<TrainingBackingCheck> = {}): TrainingBackingCheck => ({
  id: "check-1",
  org_id: "org",
  trainee_user_id: "me",
  chat_id: "chat-1",
  message_id: "message-1",
  status: "ready",
  conclusions: [],
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:00:00Z",
  ...over,
});

const save = vi.fn();

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useTrainingBacking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    save.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("asks nothing when it is not enabled, there is no chat, or an answer is streaming", async () => {
    const load = vi.fn().mockResolvedValue([check()]);
    for (const props of [
      { chatId: "chat-1", enabled: false, isResponseLoading: false },
      { chatId: null, enabled: true, isResponseLoading: false },
      { chatId: "chat-1", enabled: true, isResponseLoading: true },
    ]) {
      const { result } = renderHook(() => useTrainingBacking({ ...props, load, save }));
      await flush(60_000);
      expect(result.current.checks.size).toBe(0);
    }
    expect(load).not.toHaveBeenCalled();
  });

  it("reads when the response ends, again for a few seconds, and keys the checks by message", async () => {
    const load = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([check()]);
    const { result } = renderHook(() =>
      useTrainingBacking({ chatId: "chat-1", enabled: true, isResponseLoading: false, load, save }),
    );
    await flush(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.checks.size).toBe(0);
    await flush(3_000);
    expect(result.current.checks.get("message-1")?.id).toBe("check-1");
    await flush(20_000);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("polls while a check is pending, in one chain, and stops after two minutes", async () => {
    const load = vi.fn().mockResolvedValue([check({ status: "pending", conclusions: null })]);
    renderHook(() => useTrainingBacking({ chatId: "chat-1", enabled: true, isResponseLoading: false, load, save }));
    await flush(0);
    await flush(16_000);
    const early = load.mock.calls.length;
    await flush(TRAINING_BACKING_POLL_MS * 2);
    expect(load.mock.calls.length - early).toBeLessThanOrEqual(3);
    await flush(TRAINING_BACKING_POLL_MAX_MS + 30_000);
    const settled = load.mock.calls.length;
    await flush(60_000);
    expect(load.mock.calls.length).toBe(settled);
  });

  it("stops polling once nothing is pending", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([check({ status: "pending", conclusions: null })])
      .mockResolvedValue([check()]);
    renderHook(() => useTrainingBacking({ chatId: "chat-1", enabled: true, isResponseLoading: false, load, save }));
    await flush(16_000);
    const calls = load.mock.calls.length;
    await flush(60_000);
    expect(load.mock.calls.length).toBe(calls);
  });

  it("survives a failed read and a malformed answer", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue("nope");
    const { result } = renderHook(() =>
      useTrainingBacking({ chatId: "chat-1", enabled: true, isResponseLoading: false, load, save }),
    );
    await flush(20_000);
    expect(result.current.checks.size).toBe(0);
  });

  it("forgets the checks of another chat, and stops its timers on unmount", async () => {
    const load = vi.fn().mockResolvedValue([check()]);
    const { result, rerender, unmount } = renderHook(
      ({ chatId }) => useTrainingBacking({ chatId, enabled: true, isResponseLoading: false, load, save }),
      { initialProps: { chatId: "chat-1" } },
    );
    await flush(0);
    expect(result.current.checks.size).toBe(1);
    rerender({ chatId: "chat-2" });
    expect(result.current.checks.size).toBe(0);
    unmount();
    const calls = load.mock.calls.length;
    await flush(60_000);
    expect(load.mock.calls.length).toBe(calls);
  });

  it("saves a mark and keeps the server's updated check", async () => {
    const load = vi.fn().mockResolvedValue([check()]);
    const updated = check({ updated_at: "2026-11-08T11:00:00Z" });
    save.mockResolvedValue(updated);
    const { result } = renderHook(() =>
      useTrainingBacking({ chatId: "chat-1", enabled: true, isResponseLoading: false, load, save }),
    );
    await flush(0);
    await act(async () => {
      await result.current.mark(check(), "c1", { person_verified: true });
    });
    expect(save).toHaveBeenCalledWith("chat-1", "check-1", "c1", { person_verified: true });
    expect(result.current.checks.get("message-1")?.updated_at).toBe("2026-11-08T11:00:00Z");
  });

  it("lets a failed save reach the host and changes nothing", async () => {
    const load = vi.fn().mockResolvedValue([check()]);
    save.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() =>
      useTrainingBacking({ chatId: "chat-1", enabled: true, isResponseLoading: false, load, save }),
    );
    await flush(0);
    await expect(result.current.mark(check(), "c1", { person_verified: true })).rejects.toThrow("nope");
    expect(result.current.checks.get("message-1")?.updated_at).toBe("2026-11-08T10:00:00Z");
  });

  it("does nothing when marking without a chat", async () => {
    const { result } = renderHook(() =>
      useTrainingBacking({ chatId: null, enabled: true, isResponseLoading: false, load: vi.fn(), save }),
    );
    await result.current.mark(check(), "c1", { person_verified: true });
    expect(save).not.toHaveBeenCalled();
  });
});
