// The questions "may this person still open these documents" that a running
// table generation asks (for a watcher of the run, and for each row) are
// bounded in time: a question still unanswered after ACCESS_QUESTION_MAX_MS
// counts as "no", exactly like a question that fails, and a late answer is
// ignored.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("../observability/report", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../observability/report")>()),
    reportError,
}));

import {
    ACCESS_QUESTION_MAX_MS,
    ACCESS_RECHECK_MS,
    attachStreamRunSse,
    createWatcherGate,
    resetStreamRunsForTests,
    startStreamRun,
} from "../streamRuns";
import { currentConfirmedEmail } from "../confirmedEmail";
import { createRowReadCheck } from "../tabularReadAccess";
import { rowAccessWorld, ROW_ACCESS_EMAIL, ROW_ACCESS_USER } from "../../__tests__/helpers/rowAccessWorld";

/** A question the test answers by hand, when it chooses to. */
function openQuestion() {
    let answer!: (value: boolean) => void;
    const promise = new Promise<boolean>((resolve) => (answer = resolve));
    return { promise, answer };
}

function fakeResponse() {
    const emitter = new EventEmitter();
    const chunks: string[] = [];
    const res = {
        setHeader: () => {},
        flushHeaders: vi.fn(),
        writableEnded: false,
        write(chunk: string) {
            chunks.push(chunk);
            return true;
        },
        end() {
            res.writableEnded = true;
        },
        on: emitter.on.bind(emitter),
        chunks,
    };
    return res;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
    reportError.mockReset();
});
afterEach(() => {
    resetStreamRunsForTests();
    vi.useRealTimers();
});

it("bounds the access question at ten seconds", () => {
    expect(ACCESS_QUESTION_MAX_MS).toBe(10_000);
    expect(ACCESS_QUESTION_MAX_MS).toBeGreaterThan(ACCESS_RECHECK_MS);
});

describe("a watcher's question that does not answer", () => {
    it("ends that watcher's stream after the bound, delivering nothing that waited behind it", async () => {
        const question = openQuestion();
        const run = startStreamRun({ id: "run-1", key: "review:rev-1", userId: "starter", meta: {}, forcedStopFrames: [] })!;
        const res = fakeResponse();
        attachStreamRunSse(res as unknown as Response, run, 1, () => question.promise);

        vi.setSystemTime(Date.now() + ACCESS_RECHECK_MS + 1);
        for (const row of ["row-1", "row-2", "row-3"]) run.write(`data: ${JSON.stringify({ row })}\n\n`);
        await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS - 1);
        expect(res.writableEnded).toBe(false);
        expect(res.chunks).toEqual([]);

        await vi.advanceTimersByTimeAsync(1);
        expect(res.writableEnded).toBe(true);
        expect(res.chunks).toEqual([]);

        // The late answer changes nothing, and later frames are not delivered either.
        question.answer(true);
        run.write(`data: ${JSON.stringify({ row: "row-4" })}\n\n`);
        await vi.advanceTimersByTimeAsync(0);
        expect(res.chunks).toEqual([]);
    });

    it("never delivers a queued frame when the answer comes late, and raises nothing unhandled", async () => {
        const question = openQuestion();
        const refused = vi.fn();
        const gate = createWatcherGate(() => question.promise, refused);
        const delivered = vi.fn();
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            vi.setSystemTime(Date.now() + ACCESS_RECHECK_MS + 1);
            gate(delivered);
            gate(delivered);
            await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS);
            expect(refused).toHaveBeenCalledTimes(1);

            question.answer(true);
            gate(delivered);
            await vi.advanceTimersByTimeAsync(0);
            expect(delivered).not.toHaveBeenCalled();
            expect(refused).toHaveBeenCalledTimes(1);

            const failing = createWatcherGate(() => new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("late failure")), ACCESS_QUESTION_MAX_MS + 5_000)), vi.fn());
            vi.setSystemTime(Date.now() + ACCESS_RECHECK_MS + 1);
            failing(delivered);
            await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS + 6_000);
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });

    it("honours a question that answers just inside the bound", async () => {
        const question = openQuestion();
        const refused = vi.fn();
        const gate = createWatcherGate(() => question.promise, refused);
        const delivered = vi.fn();

        vi.setSystemTime(Date.now() + ACCESS_RECHECK_MS + 1);
        gate(delivered);
        await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS - 100);
        question.answer(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(delivered).toHaveBeenCalledTimes(1);
        // The bound's timer is gone once the question answered.
        await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS * 2);
        expect(refused).not.toHaveBeenCalled();
    });

    it("leaves no timer behind once its question answered", async () => {
        const gate = createWatcherGate(async () => true, vi.fn());
        const before = vi.getTimerCount();
        vi.setSystemTime(Date.now() + ACCESS_RECHECK_MS + 1);
        gate(vi.fn());
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(before);
    });
});

describe("a row's question that does not answer", () => {
    const row = { id: "row-1", source_document_ids: ["doc-1"] };

    it("counts as no after the bound, once warned, and a late yes changes nothing", async () => {
        const w = rowAccessWorld({ documents: 1 });
        w.unanswered.documents = true;
        const check = createRowReadCheck({ db: w.db, userId: ROW_ACCESS_USER, userEmail: ROW_ACCESS_EMAIL });

        let answer: boolean | undefined;
        void check(row).then((value) => (answer = value));
        await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS - 1);
        expect(answer).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(answer).toBe(false);
        expect(reportError).toHaveBeenCalledTimes(1);

        // Asked again later, with the database back: a fresh answer, not the old "no".
        w.unanswered.documents = false;
        vi.setSystemTime(Date.now() + 1);
        await expect(check(row)).resolves.toBe(true);
    });

    it("counts as no when the lookup of the person's address does not answer", async () => {
        const w = rowAccessWorld({ documents: 1, personal: true });
        w.unanswered.account = true;
        const check = createRowReadCheck({ db: w.db, userId: ROW_ACCESS_USER, userEmail: () => currentConfirmedEmail(w.db, ROW_ACCESS_USER) });

        let answer: boolean | undefined;
        void check(row).then((value) => (answer = value));
        await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS);
        expect(answer).toBe(false);
        expect(reportError).toHaveBeenCalledTimes(1);
    });

    it("honours an answer that comes at 9.9 seconds", async () => {
        const w = rowAccessWorld({ documents: 1 });
        const answered = { value: undefined as boolean | undefined };
        const check = createRowReadCheck({
            db: w.db,
            userId: ROW_ACCESS_USER,
            userEmail: () => new Promise<string>((resolve) => setTimeout(() => resolve(ROW_ACCESS_EMAIL), 9_900)),
        });
        void check(row).then((value) => (answered.value = value));
        await vi.advanceTimersByTimeAsync(9_899);
        expect(answered.value).toBeUndefined();
        await vi.advanceTimersByTimeAsync(101);
        expect(answered.value).toBe(true);
        expect(reportError).not.toHaveBeenCalled();
    });

    it("ignores a yes that arrives after the bound", async () => {
        const w = rowAccessWorld({ documents: 1 });
        const check = createRowReadCheck({
            db: w.db,
            userId: ROW_ACCESS_USER,
            userEmail: () => new Promise<string>((resolve) => setTimeout(() => resolve(ROW_ACCESS_EMAIL), ACCESS_QUESTION_MAX_MS + 2_000)),
        });
        let answer: boolean | undefined;
        void check(row).then((value) => (answer = value));
        await vi.advanceTimersByTimeAsync(ACCESS_QUESTION_MAX_MS);
        expect(answer).toBe(false);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(answer).toBe(false);
    });
});
