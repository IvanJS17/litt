import { describe, expect, it, vi } from "vitest";

import { localModelToleranceMiddleware } from "../llm/localModelMiddleware";
import { MODEL_TEXT_MAX_CHARS } from "../modelJsonFence";

const TOOL = "mcp_search_trademarks";
const STOP = { unified: "stop", raw: "stop" } as const;
const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPart = any;

function streamOf(parts: AnyPart[]) {
    return new ReadableStream<AnyPart>({
        start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
        },
    });
}

async function collect(stream: ReadableStream<AnyPart>): Promise<AnyPart[]> {
    const parts: AnyPart[] = [];
    for await (const part of stream as any) parts.push(part);
    return parts;
}

function textParts(parts: AnyPart[]): string {
    return parts
        .filter((part) => part.type === "text-delta")
        .map((part) => part.delta)
        .join("");
}

function reasoningParts(parts: AnyPart[]): string {
    return parts
        .filter((part) => part.type === "reasoning-delta")
        .map((part) => part.delta)
        .join("");
}

async function runStream(deltas: string[], params: AnyPart = {}) {
    const middleware = localModelToleranceMiddleware();
    const doStream = vi.fn().mockResolvedValue({
        stream: streamOf([
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            ...deltas.map((delta) => ({
                type: "text-delta",
                id: "t1",
                delta,
            })),
            { type: "text-end", id: "t1" },
            { type: "finish", usage: USAGE, finishReason: STOP },
        ]),
    });
    const doGenerate = vi.fn();
    const result = await middleware.wrapStream!({
        doStream,
        doGenerate,
        params,
        model: {} as AnyPart,
    } as AnyPart);
    return { parts: await collect(result.stream), doStream, doGenerate };
}

describe("localModelToleranceMiddleware — streaming", () => {
    it("passes an ordinary answer through untouched", async () => {
        const { parts } = await runStream(["All ", "clear."]);
        expect(textParts(parts)).toBe("All clear.");
        expect(parts.some((part) => part.type === "tool-call")).toBe(false);
        expect(parts.at(-1)).toMatchObject({ finishReason: STOP });
    });

    it("routes think blocks to reasoning instead of visible text", async () => {
        const { parts } = await runStream([
            "<think>weighing",
            " it</think>The answer.",
        ]);
        expect(reasoningParts(parts)).toBe("weighing it");
        expect(textParts(parts)).toBe("The answer.");
        expect(parts.some((part) => part.type === "reasoning-end")).toBe(true);
    });

    it("recovers a tool call from prose and hides the markup", async () => {
        const { parts } = await runStream([
            "Calling tool.\n<tool_call>",
            `{"name":"${TOOL}","arguments":{"query":"MIKE"}}`,
            "</tool_call>",
        ]);
        expect(textParts(parts)).toBe("Calling tool.\n");
        expect(
            parts.filter((part) => part.type === "tool-call"),
        ).toEqual([
            {
                type: "tool-call",
                toolCallId: "call_text_0_0_0",
                toolName: TOOL,
                input: JSON.stringify({ query: "MIKE" }),
            },
        ]);
        expect(parts.at(-1)).toMatchObject({
            finishReason: { unified: "tool-calls", raw: "stop" },
        });
    });

    it("leaves a provider's own structured tool call alone", async () => {
        const middleware = localModelToleranceMiddleware();
        const doStream = vi.fn().mockResolvedValue({
            stream: streamOf([
                { type: "stream-start", warnings: [] },
                {
                    type: "tool-call",
                    toolCallId: "real-1",
                    toolName: TOOL,
                    input: "{}",
                },
                {
                    type: "finish",
                    usage: USAGE,
                    finishReason: { unified: "tool-calls", raw: "tool_calls" },
                },
            ]),
        });
        const result = await middleware.wrapStream!({
            doStream,
            doGenerate: vi.fn(),
            params: {},
            model: {} as AnyPart,
        } as AnyPart);
        const parts = await collect(result.stream);
        expect(parts.filter((part) => part.type === "tool-call")).toHaveLength(
            1,
        );
        expect(parts.at(-1)).toMatchObject({
            finishReason: { unified: "tool-calls" },
        });
    });

    it("surfaces an unrecoverable tool call as a stream error", async () => {
        const { parts } = await runStream([
            "<tool_call>{not a tool at all}</tool_call>",
        ]);
        const error = parts.find((part) => part.type === "error");
        expect(error).toBeDefined();
        expect(String(error.error)).toMatch(
            /did not identify an executable tool|could not recover/,
        );
    });

    it("answers a tool-declaring turn through the non-streaming endpoint", async () => {
        const middleware = localModelToleranceMiddleware();
        const doStream = vi.fn();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [
                {
                    type: "text",
                    text: `<tool_call>{"name":"${TOOL}","arguments":{"query":"MIKE"}}</tool_call>`,
                },
            ],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const result = await middleware.wrapStream!({
            doStream,
            doGenerate,
            params: { tools: [{ type: "function", name: TOOL }] },
            model: {} as AnyPart,
        } as AnyPart);
        const parts = await collect(result.stream);

        expect(doGenerate).toHaveBeenCalledTimes(1);
        expect(doStream).not.toHaveBeenCalled();
        expect(parts.filter((part) => part.type === "tool-call")).toEqual([
            {
                type: "tool-call",
                toolCallId: "call_text_0_0_0",
                toolName: TOOL,
                input: JSON.stringify({ query: "MIKE" }),
            },
        ]);
    });
});

describe("localModelToleranceMiddleware — generate", () => {
    it("recovers a tool call and strips the markup from the text", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [
                {
                    type: "text",
                    text: `Calling tool.\n<tool_call>{"name":"${TOOL}","arguments":{"query":"MIKE"}}</tool_call>`,
                },
            ],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const result = await middleware.wrapGenerate!({
            doGenerate,
            doStream: vi.fn(),
            params: {},
            model: {} as AnyPart,
        } as AnyPart);

        expect(result.content).toEqual([
            { type: "text", text: "Calling tool.\n" },
            {
                type: "tool-call",
                toolCallId: "call_text_0_0_0",
                toolName: TOOL,
                input: JSON.stringify({ query: "MIKE" }),
            },
        ]);
        expect(result.finishReason).toEqual({
            unified: "tool-calls",
            raw: "stop",
        });
    });

    it("moves think prose into a reasoning part", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [
                { type: "text", text: "<think>hmm</think>Done." },
            ],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const result = await middleware.wrapGenerate!({
            doGenerate,
            doStream: vi.fn(),
            params: {},
            model: {} as AnyPart,
        } as AnyPart);

        expect(result.content).toEqual([
            { type: "reasoning", text: "hmm" },
            { type: "text", text: "Done." },
        ]);
        expect(result.finishReason).toEqual(STOP);
    });
});

describe("localModelToleranceMiddleware — a reply longer than the bound that applies to model text", () => {
    const CALL = `<tool_call>{"name":"${TOOL}","arguments":{"query":"MIKE"}}</tool_call>`;
    const over = (head: string, tail = "") => head + " ".repeat(MODEL_TEXT_MAX_CHARS) + tail;
    const UNREADABLE = /could not read|could not recover/;

    it("ends a streamed step with an error when it holds tool markup, as for markup that cannot be read", async () => {
        const { parts } = await runStream(["Calling the tool.\n", over(CALL)]);
        const error = parts.find((part) => part.type === "error");
        expect(error).toBeDefined();
        expect(String(error.error)).toMatch(UNREADABLE);
        expect(parts.filter((part) => part.type === "tool-call")).toEqual([]);
        expect(textParts(parts)).toBe("Calling the tool.\n");
    });

    it("ends a replayed step with an error when it holds tool markup", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: over(CALL) }],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const result = await middleware.wrapStream!({
            doStream: vi.fn(),
            doGenerate,
            params: { tools: [{ type: "function", name: TOOL }] },
            model: {} as AnyPart,
        } as AnyPart);
        const parts = await collect(result.stream);
        expect(String(parts.find((part) => part.type === "error")?.error)).toMatch(UNREADABLE);
        expect(parts.some((part) => part.type === "tool-call")).toBe(false);
    });

    it("fails a generated step with an error when it holds tool markup", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: over("", CALL) }],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        // The outcome is turned into a short string: a failed assertion must not try to print a megabyte.
        const outcome = await middleware
            .wrapGenerate!({ doGenerate, doStream: vi.fn(), params: {}, model: {} as AnyPart } as AnyPart)
            .then(
                () => "the step completed",
                (error: unknown) => String(error),
            );
        expect(outcome).toMatch(UNREADABLE);
    });

    it("leaves a reply with no tool markup as the plain answer it is", async () => {
        const answer = "A plain sentence. ".repeat(Math.ceil(MODEL_TEXT_MAX_CHARS / 18) + 1);
        const { parts } = await runStream([answer]);
        expect(parts.some((part) => part.type === "error")).toBe(false);
        expect(textParts(parts)).toBe(answer);
    });

    it("leaves a reply whose provider reported a tool call itself alone", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [
                { type: "text", text: over(CALL) },
                { type: "tool-call", toolCallId: "c1", toolName: TOOL, input: "{}" },
            ],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const result = await middleware.wrapGenerate!({ doGenerate, doStream: vi.fn(), params: {}, model: {} as AnyPart } as AnyPart);
        expect(result.content.filter((part: AnyPart) => part.type === "tool-call")).toHaveLength(1);
    });
});

describe("localModelToleranceMiddleware — an argument the repair bounds refuse", () => {
    // Three calls; the second holds an argument whose repair is over the limit of one text (30,000
    // characters, half of them quotes). No call of the reply may run, not even the others.
    const GOOD = (query: string) => `<tool_call>{"name":"${TOOL}","arguments":{"query":"${query}"}}</tool_call>`;
    const REFUSED = `<tool_call>{"name":"${TOOL}","arguments":{'query':${"{" + "'a".repeat(15_000)}}}</tool_call>`;
    const reply = [GOOD("one"), REFUSED, GOOD("three")].join("\n");
    const UNREADABLE = /could not recover/;

    // The same refusal by time: a closed text of 8,002 characters, which the library takes many seconds on.
    const SLOW = `<tool_call>{"name":"${TOOL}","arguments":{"query":${"{" + "'a".repeat(4_000) + "}"}}}</tool_call>`;
    it("ends a streamed step with an error, in time, when an argument is too slow to repair", async () => {
        const started = performance.now();
        const { parts } = await runStream(["Calling.\n", [GOOD("one"), SLOW, GOOD("three")].join("\n")]);
        expect(performance.now() - started).toBeLessThan(3_000);
        expect(String(parts.find((part) => part.type === "error")?.error)).toMatch(UNREADABLE);
        expect(parts.filter((part) => part.type === "tool-call")).toEqual([]);
    }, 30_000);

    it("ends a streamed step with an error and hands on no call", async () => {
        const { parts } = await runStream(["Calling.\n", reply]);
        expect(String(parts.find((part) => part.type === "error")?.error)).toMatch(UNREADABLE);
        expect(parts.filter((part) => part.type === "tool-call")).toEqual([]);
    });

    it("ends a replayed step with an error and hands on no call", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: reply }],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const result = await middleware.wrapStream!({
            doStream: vi.fn(),
            doGenerate,
            params: { tools: [{ type: "function", name: TOOL }] },
            model: {} as AnyPart,
        } as AnyPart);
        const parts = await collect(result.stream);
        expect(String(parts.find((part) => part.type === "error")?.error)).toMatch(UNREADABLE);
        expect(parts.filter((part) => part.type === "tool-call")).toEqual([]);
    });

    it("fails a generated step and hands on no call", async () => {
        const middleware = localModelToleranceMiddleware();
        const doGenerate = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: reply }],
            finishReason: STOP,
            usage: USAGE,
            warnings: [],
        });
        const outcome = await middleware
            .wrapGenerate!({ doGenerate, doStream: vi.fn(), params: {}, model: {} as AnyPart } as AnyPart)
            .then(
                (result: AnyPart) => `the step completed with ${result.content.filter((part: AnyPart) => part.type === "tool-call").length} calls`,
                (error: unknown) => String(error),
            );
        expect(outcome).toMatch(UNREADABLE);
    });
});
