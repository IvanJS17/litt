// How the streamed reply of a tabular extraction is cut into lines: each
// complete line is read once, a partial line waits for the rest of it, and the
// time taken grows in proportion to the length of the reply.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamChatWithTools } = vi.hoisted(() => ({ streamChatWithTools: vi.fn() }));
vi.mock("../../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/llm")>()),
    streamChatWithTools,
}));
vi.mock("mammoth", () => ({
    default: { convertToHtml: async () => ({ value: "" }) },
    convertToHtml: async () => ({ value: "" }),
}));
vi.mock("../../../lib/convert", () => ({
    normalizeDocxZipPaths: async (buf: Buffer) => buf,
    docxToPdf: async (buf: Buffer) => buf,
}));

import { expectLinearCostAsync } from "../../../__tests__/helpers/linearCost";
import { MODEL_TEXT_MAX_CHARS } from "../../../lib/modelJsonFence";
import { queryTabularAllColumns } from "../tabular.extract";

const COLUMNS = [
    { index: 0, name: "A", prompt: "a" },
    { index: 1, name: "B", prompt: "b" },
];
const line = (index: number, summary = "s") => JSON.stringify({ column_index: index, summary, flag: "green", reasoning: "r" });

/** Runs one extraction whose reply arrives as `deltas`; returns what each column received. */
async function consume(deltas: Iterable<string>) {
    const results: [number, string][] = [];
    streamChatWithTools.mockImplementation(async ({ callbacks }: { callbacks: { onContentDelta: (d: string) => void } }) => {
        for (const delta of deltas) callbacks.onContentDelta(delta);
    });
    await queryTabularAllColumns("m", "f.pdf", "text", COLUMNS, async (index, result) => {
        results.push([index, result.summary]);
    });
    return results;
}

beforeEach(() => vi.clearAllMocks());

describe("the lines of a streamed extraction reply", () => {
    it("reads each complete line as it arrives and the last one at the end", async () => {
        expect(await consume([line(0, "one") + "\n" + line(1, "two") + "\n"])).toEqual([[0, "one"], [1, "two"]]);
        expect(await consume([line(0, "one"), "\n", line(1, "two")])).toEqual([[0, "one"], [1, "two"]]);
        expect(await consume((line(0, "one") + "\n" + line(1, "two")).split(""))).toEqual([[0, "one"], [1, "two"]]);
    });
    it("skips blank and malformed lines and keeps the others", async () => {
        expect(await consume(["\n\n  \nnot json\n", line(1, "ok"), "\n{\"column_index\": 9}\n", "[1,2]\n", line(0, "last")])).toEqual([[1, "ok"], [0, "last"]]);
        expect(await consume([])).toEqual([]);
        expect(await consume([""])).toEqual([]);
        expect(await consume(["\r\n" + line(0, "crlf") + "\r\n"])).toEqual([[0, "crlf"]]);
    });
    it("drops a line longer than the bound of a model reply and goes on with the next", async () => {
        const huge = "x".repeat(MODEL_TEXT_MAX_CHARS + 1);
        const deltas = ["{\"column_index\": 0, \"summary\": \"", huge.slice(0, 600_000), huge.slice(600_000), "\"}\n", line(1, "after"), "\n"];
        expect(await consume(deltas)).toEqual([[1, "after"]]);
        // At the bound exactly the line is still read.
        const fits = line(0, "y".repeat(MODEL_TEXT_MAX_CHARS - line(0, "").length));
        expect(fits.length).toBe(MODEL_TEXT_MAX_CHARS);
        expect(await consume([fits.slice(0, 5), fits.slice(5), "\n"])).toEqual([[0, "y".repeat(MODEL_TEXT_MAX_CHARS - line(0, "").length)]]);
    });
    it("takes time proportional to the length of a reply without a newline", async () => {
        await expectLinearCostAsync((n) => consume((function* () { for (let i = 0; i < n; i++) yield "abcdefgh"; })()), { small: 2_000, large: 64_000 });
    }, 120_000);
    it("takes time proportional to the length of a reply of many lines in few pieces", async () => {
        await expectLinearCostAsync((n) => consume([("\n").repeat(n)]), { small: 2_000, large: 64_000 });
        await expectLinearCostAsync((n) => consume([("x\n").repeat(n) + "tail"]), { small: 2_000, large: 64_000 });
    }, 120_000);
    it("takes time proportional to the length of a reply of many lines in many pieces", async () => {
        await expectLinearCostAsync((n) => consume((function* () { for (let i = 0; i < n; i++) yield "ab\n"; })()), { small: 2_000, large: 64_000 });
    }, 120_000);
});
