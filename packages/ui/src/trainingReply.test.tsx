import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  focusTrainingAttempt,
  quoteTrainingQuestion,
  requestTrainingReply,
  useTrainingReply,
  withTrainingReply,
} from "./trainingReply";

afterEach(() => vi.restoreAllMocks());

describe("quoting a basis question", () => {
  it("quotes every line", () => {
    expect(quoteTrainingQuestion("  ¿En qué se apoya?\nY ¿por qué?\n\nPorque.  ")).toBe(
      "> ¿En qué se apoya?\n> Y ¿por qué?\n>\n> Porque.",
    );
  });

  it("puts the quote before what was already written", () => {
    expect(withTrainingReply("", "¿Por qué?")).toBe("> ¿Por qué?\n\n");
    expect(withTrainingReply("  Mi idea.", "¿Por qué?")).toBe("> ¿Por qué?\n\nMi idea.");
  });
});

describe("useTrainingReply", () => {
  it("hands the question to a composer that owes an approach", () => {
    const onReply = vi.fn();
    renderHook(() => useTrainingReply({ enabled: true, onReply }));
    act(() => requestTrainingReply("¿Por qué?", "chat-1"));
    expect(onReply).toHaveBeenCalledWith("¿Por qué?");
  });

  it("ignores a composer that owes nothing, a request for another chat and an empty one", () => {
    const off = vi.fn();
    const other = vi.fn();
    renderHook(() => useTrainingReply({ enabled: false, onReply: off }));
    renderHook(() => useTrainingReply({ enabled: true, chatId: "chat-2", onReply: other }));
    act(() => requestTrainingReply("¿Por qué?", "chat-1"));
    act(() => requestTrainingReply("   ", "chat-2"));
    act(() => window.dispatchEvent(new CustomEvent("litt:training-reply")));
    expect(off).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    act(() => requestTrainingReply("¿Por qué?"));
    act(() => requestTrainingReply("¿Y ahora?", "chat-2"));
    expect(other).toHaveBeenCalledTimes(2);
  });

  it("lets a chat-scoped composer without a chat ignore a request aimed at one, but not a request without a chat", () => {
    const scoped = vi.fn();
    const lenient = vi.fn();
    renderHook(() => useTrainingReply({ enabled: true, chatScoped: true, onReply: scoped }));
    renderHook(() => useTrainingReply({ enabled: true, onReply: lenient }));
    act(() => requestTrainingReply("¿Por qué?", "chat-2"));
    expect(scoped).not.toHaveBeenCalled();
    expect(lenient).toHaveBeenCalledWith("¿Por qué?");
    act(() => requestTrainingReply("¿Cómo?"));
    expect(scoped).toHaveBeenCalledWith("¿Cómo?");
  });

  it("uses the latest handler and stops listening on unmount", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ onReply }) => useTrainingReply({ enabled: true, onReply }),
      { initialProps: { onReply: first } },
    );
    rerender({ onReply: second });
    act(() => requestTrainingReply("¿Por qué?"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unmount();
    act(() => requestTrainingReply("¿Otra?"));
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("focusTrainingAttempt", () => {
  it("focuses the approach field with the cursor at its end", async () => {
    const { container } = render(<textarea id="attempt" defaultValue="> ¿Por qué?\n\n" />);
    const field = container.querySelector("textarea") as HTMLTextAreaElement;
    focusTrainingAttempt("attempt");
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.selectionStart).toBe(field.value.length);
  });

  it("does nothing when the field is not there or is not a textarea", async () => {
    const frame = vi.spyOn(window, "requestAnimationFrame");
    render(<input id="not-a-textarea" />);
    focusTrainingAttempt("missing");
    focusTrainingAttempt("not-a-textarea");
    await vi.waitFor(() => expect(frame).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(document.body);
  });
});
