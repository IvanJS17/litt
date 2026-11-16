import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../../../word-addin/src/shared/chat/Markdown";
import { projectCitationMarkdown } from "../../../word-addin/src/taskpane/lib/citations";
import { useWordReviewRefs } from "../../../word-addin/src/taskpane/hooks/useWordReviewRefs";

const getCloudWordChat = vi.hoisted(() => vi.fn());
vi.mock("../../../word-addin/src/taskpane/api/mikeApi", () => ({ getCloudWordChat }));

const citations = [
  { ref: 1, quote: "First quote" },
  { ref: 2, quote: "Second quote" },
];
const markdown = projectCitationMarkdown("A [1] and B [2].", citations);

describe("Word chat citation review hint", () => {
  it("draws the hint only after the listed refs", () => {
    const { container } = render(<Markdown reviewRefs={[2]}>{markdown}</Markdown>);
    const hints = container.querySelectorAll("[data-citation-review-hint]");
    expect(hints).toHaveLength(1);
    expect(hints[0]).toHaveAttribute("data-citation-review-hint", "2");
    expect(hints[0].previousElementSibling).toHaveTextContent("2");
    expect(hints[0]).toHaveTextContent("Check this citation");
    expect(hints[0].querySelector(".sr-only")).toHaveTextContent(/automatic review/i);
  });

  it("draws nothing without refs", () => {
    const { container } = render(<Markdown>{markdown}</Markdown>);
    expect(container.querySelector("[data-citation-review-hint]")).toBeNull();
    const none = render(<Markdown reviewRefs={[]}>{markdown}</Markdown>);
    expect(none.container.querySelector("[data-citation-review-hint]")).toBeNull();
  });
});

describe("useWordReviewRefs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getCloudWordChat.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const answer = {
    id: "m1",
    role: "assistant" as const,
    events: [],
    citations,
    live: false,
  };

  it("reads the chat again at 10 s and 40 s after an answer finishes", async () => {
    getCloudWordChat.mockResolvedValue({
      messages: [{ id: "m1", role: "assistant", reviewRefs: [1] }],
    });
    const { result, rerender } = renderHook(
      (loading: boolean) =>
        useWordReviewRefs({
          chatId: "c1",
          documentId: "d1",
          storage: "cloud",
          messages: [answer],
          isResponseLoading: loading,
        }),
      { initialProps: true },
    );
    rerender(false);
    expect(result.current(answer)).toBeUndefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getCloudWordChat).toHaveBeenCalledTimes(1);
    expect(getCloudWordChat).toHaveBeenCalledWith("d1", "c1");
    expect(result.current(answer)).toEqual([1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getCloudWordChat).toHaveBeenCalledTimes(2);
  });

  it("does not read a device-only chat", async () => {
    const { rerender } = renderHook(
      (loading: boolean) =>
        useWordReviewRefs({
          chatId: "c1",
          documentId: "d1",
          storage: "local",
          messages: [answer],
          isResponseLoading: loading,
        }),
      { initialProps: true },
    );
    rerender(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(41_000);
    });
    expect(getCloudWordChat).not.toHaveBeenCalled();
  });
});
