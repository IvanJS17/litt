import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    createMcpChatSink,
    errorFrameMessage,
    resetMcpChatOutcomesForTests,
    turnErrorMessage,
} from "../mcp.chatSink";

const fakeRun = () => {
    const controller = new AbortController();
    return {
        id: "turn-1",
        signal: controller.signal,
        stopReason: null as "user" | null,
        write: vi.fn(() => true),
        finish: vi.fn(),
        touch: vi.fn(),
    };
};

beforeEach(() => resetMcpChatOutcomesForTests());

describe("errorFrameMessage", () => {
    it("reads the message of an error frame only", () => {
        expect(errorFrameMessage(`data: ${JSON.stringify({ type: "error", message: "Boom" })}\n\n`)).toBe("Boom");
        expect(errorFrameMessage(`data: ${JSON.stringify({ type: "content", text: "hi" })}\n\n`)).toBeNull();
        expect(errorFrameMessage(`data: ${JSON.stringify({ type: "error", message: 5 })}\n\n`)).toBeNull();
        expect(errorFrameMessage("data: [DONE]\n\n")).toBeNull();
        expect(errorFrameMessage(": keep-alive\n\n")).toBeNull();
        expect(errorFrameMessage("data: {not json\n\n")).toBeNull();
    });

    it("keeps a long message short", () => {
        expect(errorFrameMessage(`data: ${JSON.stringify({ type: "error", message: "x".repeat(900) })}\n\n`)).toHaveLength(500);
    });
});

describe("createMcpChatSink", () => {
    it("passes every frame, the signal, the stop reason, touch and finish through to the run", () => {
        const run = fakeRun();
        const sink = createMcpChatSink(run);
        expect(sink.id).toBe("turn-1");
        expect(sink.signal).toBe(run.signal);
        expect(sink.write("data: [DONE]\n\n", { replay: false } as never)).toBe(true);
        expect(run.write).toHaveBeenCalledWith("data: [DONE]\n\n", { replay: false });
        sink.touch();
        sink.finish();
        expect(run.touch).toHaveBeenCalledOnce();
        expect(run.finish).toHaveBeenCalledOnce();
        // The stop reason is read live, not copied when the sink is made.
        expect(sink.stopReason).toBeNull();
        run.stopReason = "user";
        expect(sink.stopReason).toBe("user");
    });

    it("remembers why a turn ended in an error, and only then", () => {
        const run = fakeRun();
        const sink = createMcpChatSink(run);
        sink.write(`data: ${JSON.stringify({ type: "content", text: "hola" })}\n\n`);
        expect(turnErrorMessage("turn-1")).toBeNull();
        sink.write(`data: ${JSON.stringify({ type: "error", message: "Provider down" })}\n\n`);
        expect(turnErrorMessage("turn-1")).toBe("Provider down");
        expect(turnErrorMessage("other")).toBeNull();
    });

    it("forgets old outcomes and never holds more than a bounded number", () => {
        vi.useFakeTimers();
        try {
            for (let i = 0; i < 520; i++) {
                const run = { ...fakeRun(), id: `t-${i}` };
                createMcpChatSink(run).write(`data: ${JSON.stringify({ type: "error", message: `e${i}` })}\n\n`);
            }
            expect(turnErrorMessage("t-0")).toBeNull();
            expect(turnErrorMessage("t-519")).toBe("e519");
            vi.setSystemTime(Date.now() + 31 * 60_000);
            createMcpChatSink({ ...fakeRun(), id: "late" }).write(`data: ${JSON.stringify({ type: "error", message: "late" })}\n\n`);
            expect(turnErrorMessage("t-519")).toBeNull();
            expect(turnErrorMessage("late")).toBe("late");
        } finally {
            vi.useRealTimers();
        }
    });
});
