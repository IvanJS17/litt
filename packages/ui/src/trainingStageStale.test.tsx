import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  isTrainingRefusalCode,
  markTrainingStageStale,
  useTrainingStageStale,
} from "./trainingStageStale";

describe("training stage staleness", () => {
  it("calls the latest handler every time a refusal marks the stage stale", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(({ fn }) => useTrainingStageStale(fn), {
      initialProps: { fn: first },
    });
    act(() => markTrainingStageStale());
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ fn: second });
    act(() => markTrainingStageStale());
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    act(() => markTrainingStageStale());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not listen while disabled", () => {
    const handler = vi.fn();
    renderHook(() => useTrainingStageStale(handler, false));
    act(() => markTrainingStageStale());
    expect(handler).not.toHaveBeenCalled();
  });

  it("knows the codes with which the server refuses a stale composer", () => {
    expect(isTrainingRefusalCode("training_attempt_required")).toBe(true);
    expect(isTrainingRefusalCode("training_confidence_required")).toBe(true);
    expect(isTrainingRefusalCode("validation")).toBe(false);
    expect(isTrainingRefusalCode(undefined)).toBe(false);
  });
});
