import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeText } = vi.hoisted(() => ({
    completeText: vi.fn(),
}));

vi.mock("../../../lib/llm", () => ({ completeText }));

import { generateAssistantChatTitle, logChatTitleFailure } from "../chat.title";
import { UserFacingError } from "../../../lib/userFacingError";

describe("logChatTitleFailure", () => {
    const apiCallError = (statusCode: number) =>
        Object.assign(new Error("provider answered"), {
            name: "AI_APICallError",
            statusCode,
        });
    // What the reply throws for the same rejected key: the route's wrapper,
    // whose cause chain ends in the provider's answer.
    const replyRejectedKey = () =>
        new Error("stream failed", {
            cause: new UserFacingError("The Gemini API key was rejected.", {
                cause: apiCallError(400),
            }),
        });

    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    // A provider or configuration failure is a warning: the reply already
    // logged the same provider problem (MIKE-BACKEND-D), so the title line is
    // context, not a new fault.
    it("logs a title failure the reply shares as a warning, not an error", () => {
        logChatTitleFailure("[t]", apiCallError(400), replyRejectedKey());
        expect(console.error).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("treats a missing key as a configuration failure, not an error", () => {
        logChatTitleFailure(
            "[t]",
            new UserFacingError("Gemini API key required"),
            new Error("stream failed", {
                cause: new UserFacingError("Gemini API key required"),
            }),
        );
        expect(console.error).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    // A separately configured title model, or a rate limit only the short
    // title call hit: the reply succeeded, so this line is the only trace.
    it("logs a title-only provider failure once, as a warning", () => {
        const retryError = Object.assign(new Error("retries exhausted"), {
            name: "AI_RetryError",
            lastError: Object.assign(new Error("rate limited"), {
                name: "AI_APICallError",
                statusCode: 429,
            }),
        });
        logChatTitleFailure("[t]", retryError, null);
        expect(console.error).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it("still logs anything else — a failed title write, a bug — as an error", () => {
        const bug = new TypeError("cannot read properties of undefined");
        logChatTitleFailure("[t]", bug, null);
        expect(console.error).toHaveBeenCalledWith("[t]", bug);
    });
});

describe("generateAssistantChatTitle", () => {
    afterEach(() => vi.useRealTimers());

    it("bounds a title provider that ignores abort", async () => {
        vi.useFakeTimers();
        completeText.mockImplementation(() => new Promise(() => {}));
        const pending = generateAssistantChatTitle({
            model: "title-model",
            message: "Hello",
        });
        const rejected = expect(pending).rejects.toMatchObject({
            name: "TimeoutError",
        });
        await vi.advanceTimersByTimeAsync(15_001);
        await rejected;
        expect(completeText.mock.calls[0][0].abortSignal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("releases a pending title immediately on user Stop", async () => {
        vi.useFakeTimers();
        completeText.mockImplementation(() => new Promise(() => {}));
        const controller = new AbortController();
        const pending = generateAssistantChatTitle({
            model: "title-model",
            message: "Hello",
            abortSignal: controller.signal,
        });
        const rejected = expect(pending).rejects.toMatchObject({
            name: "AbortError",
        });
        controller.abort();
        await rejected;
        expect(completeText.mock.calls[0][0].abortSignal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("normalizes and returns the generated title", async () => {
        completeText.mockResolvedValue('  "German Liquidity Review."  ');

        await expect(
            generateAssistantChatTitle({
                model: "title-model",
                message: "Review the company liquidity position",
                apiKeys: {},
            }),
        ).resolves.toBe("German Liquidity Review");
        expect(completeText).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "title-model",
                maxTokens: 64,
                apiKeys: {},
            }),
        );
    });

    it("uses the fallback for an empty model response", async () => {
        completeText.mockResolvedValue("   ");

        await expect(
            generateAssistantChatTitle({
                model: "title-model",
                message: "Hello",
            }),
        ).resolves.toBe("Misc. Query");
    });

    it("limits generated titles to 80 characters", async () => {
        completeText.mockResolvedValue("x".repeat(100));

        await expect(
            generateAssistantChatTitle({
                model: "title-model",
                message: "Hello",
            }),
        ).resolves.toBe("x".repeat(80));
    });
});
