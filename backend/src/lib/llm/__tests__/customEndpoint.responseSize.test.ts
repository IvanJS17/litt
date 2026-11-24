import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A user-chosen endpoint's answers are read under a decoded-size ceiling,
// except a streamed completion, which is bounded by the run's output ceiling.
// The real guardedFetch runs; only DNS and the transport are stubbed.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));

import { fetch as undiciFetch } from "undici";
import { completeWithProvider } from "../providers";
import { streamChatWithTools } from "../index";
import { deadlineMessage, resetStreamRunsForTests, setRunByteLimitForTests } from "../../streamRuns";

const transport = vi.mocked(undiciFetch);
const MiB = 1024 * 1024;
const apiKeys = { custom: "sk-custom", providerSettings: { custom: { baseUrl: "https://llm.firm.example/v1" } } };

/** A body of `total` bytes in 64 KiB pieces that records how much was pulled. */
function bigBody(total: number, contentType: string, status = 200) {
    const pulled = { bytes: 0 };
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (pulled.bytes >= total) return controller.close();
            const piece = new Uint8Array(64 * 1024).fill(32);
            pulled.bytes += piece.byteLength;
            controller.enqueue(piece);
        },
    });
    return { response: new Response(body, { status, headers: { "content-type": contentType } }) as never, pulled };
}

/** SSE pieces of `size` bytes made by `piece(i)`, until `total` bytes were pulled; never closes early. */
function sseBody(total: number, piece: (i: number) => string) {
    const pulled = { bytes: 0 };
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (pulled.bytes >= total) return controller.close();
            const bytes = encoder.encode(piece(i++));
            pulled.bytes += bytes.byteLength;
            controller.enqueue(bytes);
        },
    });
    return { response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) as never, pulled };
}
const OUTPUT_LIMIT = deadlineMessage("output_limit");
const namelessToolFrame = () =>
    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "x".repeat(64 * 1024) } }] }, finish_reason: null }] })}\n\n`;
const streamParams = {
    model: "custom/any-model",
    systemPrompt: "S",
    messages: [{ role: "user", content: "go" }],
    apiKeys,
} as never;

beforeEach(() => {
    resetStreamRunsForTests();
    lookupMock.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    transport.mockReset();
});

afterEach(() => resetStreamRunsForTests());

describe("custom endpoint response size", () => {
    it("stops reading a non-streaming answer past the ceiling", async () => {
        const { response, pulled } = bigBody(64 * MiB, "application/json");
        transport.mockResolvedValue(response);
        await expect(
            completeWithProvider({ model: "custom/any-model", user: "Summarize", apiKeys }),
        ).rejects.toThrow();
        expect(pulled.bytes).toBeLessThan(12 * MiB);
    });

    it("stops reading an error body past the ceiling", async () => {
        const { response, pulled } = bigBody(64 * MiB, "text/html", 500);
        transport.mockResolvedValue(response);
        await expect(
            completeWithProvider({ model: "custom/any-model", user: "Summarize", apiKeys }),
        ).rejects.toThrow();
        expect(pulled.bytes).toBeLessThan(12 * MiB);
    });

    it("caps the error answer to a streamed call as a non-streaming answer", async () => {
        // The streamed ceiling is for a successful stream; an error body is read up to the non-streaming cap.
        setRunByteLimitForTests(32 * MiB);
        const attempts: { bytes: number }[] = [];
        transport.mockImplementation((async () => {
            // Short lines, so only the total ceiling can stop the read.
            const { response, pulled } = sseBody(64 * MiB, () => `${" ".repeat(1023)}\n`.repeat(64));
            attempts.push(pulled);
            return new Response((response as Response).body, { status: 500, headers: { "content-type": "application/json" } });
        }) as never);
        await expect(streamChatWithTools(streamParams)).rejects.toThrow();
        expect(attempts.length).toBeGreaterThan(0);
        for (const pulled of attempts) expect(pulled.bytes).toBeLessThan(12 * MiB);
    }, 60_000);

    it("does not cut a long streamed answer", async () => {
        // Ten MiB of answer text in 1 KiB deltas: more than the ceiling above.
        const encoder = new TextEncoder();
        const piece = "x".repeat(1024);
        const events = 10 * 1024;
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent === events) {
                    controller.enqueue(encoder.encode(
                        `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
                    ));
                    sent += 1;
                    return;
                }
                if (sent > events) return controller.close();
                const delta = sent === 0 ? { role: "assistant", content: piece } : { content: piece };
                controller.enqueue(encoder.encode(
                    `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
                ));
                sent += 1;
            },
        });
        transport.mockResolvedValue(
            new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) as never,
        );
        const result = await streamChatWithTools({
            model: "custom/any-model",
            systemPrompt: "S",
            messages: [{ role: "user", content: "go" }],
            apiKeys,
        } as never);
        expect(result.fullText.length).toBe(events * 1024);
    }, 60_000);

    it("caps a non-streaming call as non-streaming even when the server answers as an event stream", async () => {
        const { response, pulled } = sseBody(64 * MiB, () => `: ${" ".repeat(64 * 1024 - 4)}\n\n`);
        transport.mockResolvedValue(response);
        await expect(
            completeWithProvider({ model: "custom/any-model", user: "Summarize", apiKeys }),
        ).rejects.toThrow(OUTPUT_LIMIT);
        expect(pulled.bytes).toBeLessThan(12 * MiB);
    });

    it("stops a streamed answer whose tool arguments never get a name, with the output-limit refusal", async () => {
        setRunByteLimitForTests(1 * MiB);
        const { response, pulled } = sseBody(16 * MiB, namelessToolFrame);
        transport.mockResolvedValue(response);
        await expect(streamChatWithTools(streamParams)).rejects.toThrow(OUTPUT_LIMIT);
        expect(pulled.bytes).toBeLessThan(6 * MiB);
    }, 30_000);

    it("stops a streamed body of lines that carry no answer at a total byte ceiling", async () => {
        setRunByteLimitForTests(1 * MiB);
        const { response, pulled } = sseBody(16 * MiB, () => `${": keep-alive\n".repeat(4096)}`);
        transport.mockResolvedValue(response);
        await expect(streamChatWithTools(streamParams)).rejects.toThrow(OUTPUT_LIMIT);
        expect(pulled.bytes).toBeLessThan(6 * MiB);
    }, 30_000);

    it("stops one event line that never ends at the per-line ceiling", async () => {
        const { response, pulled } = sseBody(32 * MiB, () => "x".repeat(64 * 1024));
        transport.mockResolvedValue(response);
        await expect(streamChatWithTools(streamParams)).rejects.toThrow(OUTPUT_LIMIT);
        expect(pulled.bytes).toBeLessThan(12 * MiB);
    }, 30_000);

    it("ends a non-streaming call whose answer never arrives, at the request time limit", async () => {
        const limit = new AbortController();
        const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(limit.signal);
        try {
            transport.mockImplementation((async (_url: unknown, init?: RequestInit) =>
                new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                )) as never);
            const call = completeWithProvider({ model: "custom/any-model", user: "Summarize", apiKeys }).then(
                () => "settled",
                () => "settled",
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
            limit.abort(new DOMException("limit", "TimeoutError"));
            const outcome = await Promise.race([call, new Promise((resolve) => setTimeout(() => resolve("hangs"), 1500))]);
            expect(outcome).toBe("settled");
            expect(timeout).toHaveBeenCalled();
        } finally {
            timeout.mockRestore();
        }
    }, 10_000);

    it("gives a non-streaming call exactly two minutes", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        // Timeout signals run on the engine's own timer; make this one run on the fake clock.
        const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
            const limit = new AbortController();
            setTimeout(() => limit.abort(new DOMException("limit", "TimeoutError")), ms);
            return limit.signal;
        });
        try {
            const signals: AbortSignal[] = [];
            transport.mockImplementation((async (_url: unknown, init?: RequestInit) => {
                signals.push(init!.signal!);
                return new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
                        },
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }) as never);
            void completeWithProvider({ model: "custom/any-model", user: "Summarize", apiKeys }).catch(() => undefined);
            // Real turns of the event loop (setImmediate is not faked) let the request reach the transport.
            const turn = () => new Promise((resolve) => setImmediate(resolve));
            for (let i = 0; i < 50_000 && signals.length === 0; i++) await turn();
            expect(signals).toHaveLength(1);
            await vi.advanceTimersByTimeAsync(119_999);
            expect(signals[0].aborted).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(signals[0].aborted).toBe(true);
            // Let the library finish with the aborted call (it may retry, each try with its own limit).
            for (let i = 0; i < 900 && signals.length < 4; i++) {
                await vi.advanceTimersByTimeAsync(1_000);
                await turn();
            }
        } finally {
            timeout.mockRestore();
            vi.useRealTimers();
        }
    }, 30_000);
});
