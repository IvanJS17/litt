import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../observability/report", () => ({
    reportError: (...args: unknown[]) => {
        reported.calls.push(args);
    },
}));

import { readDraftReviewRefs, readReviewRefs, reviewRefsOf } from "../review";
import { QUESTION_VERSION } from "../typesafe";

type Row = Record<string, unknown>;

/** A tiny in-memory citation_support_checks that applies eq / in / gt filters. */
function memoryDb(rows: Row[], failWith: unknown = null) {
    const queries: { table: string; eq: Record<string, unknown>; in: Record<string, unknown[]> }[] = [];
    const db = {
        from(table: string) {
            const query = { table, eq: {} as Record<string, unknown>, in: {} as Record<string, unknown[]> };
            queries.push(query);
            let after: unknown = null;
            let max = Infinity;
            const run = () => {
                if (failWith) return Promise.resolve({ data: null, error: failWith });
                const data = rows
                    .filter((row) => Object.entries(query.eq).every(([k, v]) => row[k] === v))
                    .filter((row) => Object.entries(query.in).every(([k, v]) => v.includes(row[k])))
                    .filter((row) => after === null || (row.id as string) > (after as string))
                    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1))
                    .slice(0, max);
                return Promise.resolve({ data, error: null });
            };
            const builder: Record<string, unknown> = {
                select: () => builder,
                eq: (column: string, value: unknown) => ((query.eq[column] = value), builder),
                in: (column: string, values: unknown[]) => ((query.in[column] = values), builder),
                gt: (_column: string, value: unknown) => ((after = value), builder),
                order: () => builder,
                limit: (n: number) => ((max = n), builder),
                then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad),
            };
            return builder;
        },
    };
    return { db: db as never, queries };
}

const check = (id: string, owner: string, ref: number, band: string, extra: Row = {}): Row => ({
    id,
    message_id: owner,
    citation_ref: ref,
    band,
    probability: band === "not_supported" ? 0.1 : band === "review" ? 0.5 : 0.9,
    question_version: QUESTION_VERSION,
    ...extra,
});

describe("readReviewRefs", () => {
    beforeEach(() => {
        reported.calls.length = 0;
        vi.stubEnv("LITT_CITATION_CHECK", "enabled");
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("returns only the refs of the low band, sorted, and nothing about the other bands or any number", async () => {
        const { db } = memoryDb([
            check("a1", "m1", 3, "not_supported"),
            check("a2", "m1", 1, "not_supported"),
            check("a3", "m1", 2, "review"),
            check("a4", "m1", 4, "supported"),
            check("a5", "m2", 1, "supported"),
        ]);
        const refs = await readReviewRefs(db, "chat", ["m1", "m2", "m3"]);
        expect(reviewRefsOf(refs, "m1")).toEqual([1, 3]);
        expect(reviewRefsOf(refs, "m2")).toEqual([]);
        expect(reviewRefsOf(refs, "m3")).toEqual([]);
        expect([...refs.keys()]).toEqual(["m1"]);
        expect(JSON.stringify([...refs])).not.toMatch(/probab|0\.[0-9]/);
    });

    it("asks the database for the low band of the current question only, for the owners it was given", async () => {
        const { db, queries } = memoryDb([
            check("a1", "m1", 1, "not_supported", { question_version: "older-question" }),
            check("a2", "other", 1, "not_supported"),
        ]);
        const refs = await readReviewRefs(db, "chat", ["m1"]);
        expect(refs.size).toBe(0);
        expect(queries[0].eq).toMatchObject({ band: "not_supported", question_version: QUESTION_VERSION });
        expect(queries[0].in).toEqual({ message_id: ["m1"] });
    });

    it("uses the owner column of each surface", async () => {
        const { db } = memoryDb([
            { id: "w", word_message_id: "w1", citation_ref: 2, band: "not_supported", question_version: QUESTION_VERSION },
            { id: "t", tabular_chat_message_id: "t1", citation_ref: 5, band: "not_supported", question_version: QUESTION_VERSION },
        ]);
        expect(reviewRefsOf(await readReviewRefs(db, "word", ["w1"]), "w1")).toEqual([2]);
        expect(reviewRefsOf(await readReviewRefs(db, "tabular_chat", ["t1"]), "t1")).toEqual([5]);
    });

    it.each(["disabled", "", "true"])("returns nothing and reads nothing when the server switch is %j", async (value) => {
        vi.stubEnv("LITT_CITATION_CHECK", value);
        const { db, queries } = memoryDb([check("a1", "m1", 1, "not_supported")]);
        expect((await readReviewRefs(db, "chat", ["m1"])).size).toBe(0);
        expect(queries).toHaveLength(0);
    });

    it("reads nothing for an empty owner list", async () => {
        const { db, queries } = memoryDb([]);
        expect((await readReviewRefs(db, "chat", [])).size).toBe(0);
        expect(queries).toHaveLength(0);
    });

    it("never fails the payload it decorates: a read error is one report and no refs", async () => {
        const { db } = memoryDb([], { code: "XX000", message: "SECRET-DB-DETAIL" });
        expect((await readReviewRefs(db, "chat", ["m1"])).size).toBe(0);
        expect(reported.calls).toHaveLength(1);
    });
});

describe("readDraftReviewRefs", () => {
    const FIRST = "2026-11-16T10:00:05.000Z";
    const rows = (): Row[] => [
        { id: "a", playbook_id: "p1", citation_ref: 1, band: "not_supported", created_at: FIRST, question_version: QUESTION_VERSION },
        { id: "b", playbook_id: "p1", citation_ref: 2, band: "supported", created_at: "2026-11-16T10:00:07.000Z", question_version: QUESTION_VERSION },
        { id: "c", playbook_id: "p1", citation_ref: 3, band: "not_supported", created_at: "2026-11-16T10:00:09.000Z", question_version: QUESTION_VERSION },
    ];
    beforeEach(() => {
        vi.stubEnv("LITT_CITATION_CHECK", "enabled");
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    // The memory db filters on every eq(); this one is the plain playbook read.
    const dbFor = (data: Row[]) =>
        ({
            from: () => {
                const builder: Record<string, unknown> = {
                    select: () => builder,
                    eq: () => builder,
                    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
                };
                return builder;
            },
        }) as never;

    it("returns the low-band refs while the playbook is as the draft left it", async () => {
        expect(await readDraftReviewRefs(dbFor(rows()), "p1", "2026-11-16T10:00:04.000Z")).toEqual([1, 3]);
    });

    it("returns nothing once the playbook changed after the draft (refs are positions in the old content)", async () => {
        expect(await readDraftReviewRefs(dbFor(rows()), "p1", "2026-11-16T10:30:00.000Z")).toEqual([]);
    });

    it("returns nothing when the switch is off or there are no results", async () => {
        expect(await readDraftReviewRefs(dbFor([]), "p1", FIRST)).toEqual([]);
        vi.stubEnv("LITT_CITATION_CHECK", "disabled");
        expect(await readDraftReviewRefs(dbFor(rows()), "p1", "2026-11-16T10:00:04.000Z")).toEqual([]);
    });
});
