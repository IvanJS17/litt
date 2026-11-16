import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../observability/report", () => ({
    reportError: (...args: unknown[]) => {
        reported.calls.push(args);
    },
}));

import {
    createCitationSupportRunner,
    createCitationSupportTurn,
    forgetCitationSupportChecks,
    runCitationSupportChecks,
} from "../check";
import type { CitationSupportInput } from "../inputs";

// The real TypeSafe API and database are never touched: both are mocks.
const SECRET = "synthetic-typesafe-key-0002";
const CLAIM = "AFIRMACION-CONFIDENCIAL-DEL-CLIENTE";
const QUOTE = "CITA-CONFIDENCIAL-DEL-CLIENTE";
const CONTEXT = "CONTEXTO-CONFIDENCIAL-DEL-CLIENTE";

const input = (ref: number): CitationSupportInput => ({
    ref,
    documentId: "11111111-1111-4111-8111-111111111111",
    versionId: "22222222-2222-4222-8222-222222222222",
    startChar: 10,
    endChar: 40,
    state: { afirmacion: `${CLAIM} ${ref}`, cita: QUOTE, contexto: CONTEXT },
});

const SCOPE = {
    orgId: "org-1",
    ownerId: "message-1",
    surface: "chat" as const,
};

function memoryDb(insertError: { code: string } | null = null) {
    const rows: Record<string, unknown>[] = [];
    const tables: string[] = [];
    const db = {
        from(table: string) {
            tables.push(table);
            return {
                insert: async (row: Record<string, unknown>) => {
                    if (insertError) return { error: insertError };
                    rows.push(row);
                    return { error: null };
                },
            };
        },
    };
    return { db: db as never, rows, tables };
}

const jevAnswer = (p: number) =>
    new Response(
        JSON.stringify({ model: "jev-1.14.0", answers: { respalda: { type: "noul", noul: p } }, usage: { input_tokens: 900, output_tokens: 3 } }),
        { status: 200, headers: { "content-type": "application/json" } },
    );
const deps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
    fetch: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
});

beforeEach(() => {
    process.env.LITT_CITATION_CHECK = "enabled";
    process.env.TYPESAFE_API_KEY = SECRET;
});

afterEach(() => {
    delete process.env.LITT_CITATION_CHECK;
    delete process.env.TYPESAFE_API_KEY;
    reported.calls.length = 0;
    vi.restoreAllMocks();
});

describe("runCitationSupportChecks", () => {
    it("asks once per citation, in the pilot's shape, and inserts the evidence", async () => {
        const { db, rows, tables } = memoryDb();
        const probabilities = new Map([[1, 0.9], [2, 0.5], [3, 0.1]]);
        const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
            const ref = Number(JSON.parse(init.body as string).state.afirmacion.split(" ").pop());
            return jevAnswer(probabilities.get(ref)!);
        });
        const outcome = await runCitationSupportChecks({
            db,
            apiKey: SECRET,
            scope: SCOPE,
            inputs: [input(1), input(2), input(3)],
            deps: deps(fetchImpl),
        });
        expect(outcome).toEqual({ checked: 3, failed: 0, firstFailure: null });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(new Set(tables)).toEqual(new Set(["citation_support_checks"]));
        const byRef = Object.fromEntries(rows.map((r) => [r.citation_ref, r]));
        expect(byRef[1]).toMatchObject({
            organization_id: "org-1",
            message_id: "message-1",
            document_id: "11111111-1111-4111-8111-111111111111",
            version_id: "22222222-2222-4222-8222-222222222222",
            start_char: 10,
            end_char: 40,
            probability: 0.9,
            band: "supported",
            model: "jev-1.14.0",
            question_version: "noul-rico-v2",
            input_tokens: 900,
        });
        expect(typeof byRef[1].latency_ms).toBe("number");
        expect(byRef[2].band).toBe("review");
        expect(byRef[3].band).toBe("not_supported");
    });

    it("stores references and numbers only: no claim, quote, context or key", async () => {
        const { db, rows } = memoryDb();
        await runCitationSupportChecks({
            db,
            apiKey: SECRET,
            scope: SCOPE,
            inputs: [input(1)],
            deps: deps(vi.fn(async () => jevAnswer(0.8))),
        });
        const stored = JSON.stringify(rows);
        for (const secret of [CLAIM, QUOTE, CONTEXT, SECRET]) expect(stored).not.toContain(secret);
        expect(Object.keys(rows[0]).sort()).toEqual(
            [
                "band", "citation_ref", "document_id", "end_char", "input_tokens",
                "latency_ms", "message_id", "model", "organization_id", "probability", "question_version",
                "start_char", "version_id",
            ].sort(),
        );
    });

    it("runs the requests in parallel, six at a time at most", async () => {
        const { db } = memoryDb();
        let active = 0;
        let peak = 0;
        const fetchImpl = vi.fn(async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return jevAnswer(0.8);
        });
        const inputs = Array.from({ length: 20 }, (_, i) => input(i + 1));
        const outcome = await runCitationSupportChecks({ db, apiKey: SECRET, scope: SCOPE, inputs, deps: deps(fetchImpl) });
        expect(outcome.checked).toBe(20);
        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(6);
    });

    it.each([401, 402, 403])("stops asking after a %s and writes nothing", async (status) => {
        const { db, rows } = memoryDb();
        const fetchImpl = vi.fn(async () => new Response("{}", { status }));
        const outcome = await runCitationSupportChecks({
            db,
            apiKey: SECRET,
            scope: SCOPE,
            inputs: Array.from({ length: 30 }, (_, i) => input(i + 1)),
            deps: deps(fetchImpl),
        });
        expect(rows).toEqual([]);
        expect(outcome.checked).toBe(0);
        expect(outcome.firstFailure).toBe({ 401: "unauthorized", 402: "payment_required", 403: "forbidden" }[status]);
        // Only the requests already in flight went out; no retry of any of them.
        expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(6);
    });

    it("keeps going after a failure that is only this citation's", async () => {
        const { db, rows } = memoryDb();
        const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
            JSON.parse(init.body as string).state.afirmacion.endsWith(" 1")
                ? new Response("{}", { status: 400 })
                : jevAnswer(0.8),
        );
        const outcome = await runCitationSupportChecks({ db, apiKey: SECRET, scope: SCOPE, inputs: [input(1), input(2)], deps: deps(fetchImpl) });
        expect(outcome).toMatchObject({ checked: 1, failed: 1, firstFailure: "rejected" });
        expect(rows).toHaveLength(1);
    });

    it("writes a Word answer against the Word message", async () => {
        const { db, rows } = memoryDb();
        await runCitationSupportChecks({
            db,
            apiKey: SECRET,
            scope: { ...SCOPE, surface: "word" },
            inputs: [input(1)],
            deps: deps(vi.fn(async () => jevAnswer(0.8))),
        });
        expect(rows[0]).toMatchObject({ word_message_id: "message-1" });
        expect(rows[0]).not.toHaveProperty("message_id");
    });

    it("counts a database failure and treats a duplicate as already done", async () => {
        const failing = memoryDb({ code: "42501" });
        const outcome = await runCitationSupportChecks({ db: failing.db, apiKey: SECRET, scope: SCOPE, inputs: [input(1)], deps: deps(vi.fn(async () => jevAnswer(0.8))) });
        expect(outcome).toMatchObject({ checked: 0, failed: 1, firstFailure: "db_42501" });
        const gone = memoryDb({ code: "23503" });
        const deleted = await runCitationSupportChecks({ db: gone.db, apiKey: SECRET, scope: SCOPE, inputs: [input(1)], deps: deps(vi.fn(async () => jevAnswer(0.8))) });
        expect(deleted).toMatchObject({ failed: 0 });
        const duplicate = memoryDb({ code: "23505" });
        const again = await runCitationSupportChecks({ db: duplicate.db, apiKey: SECRET, scope: SCOPE, inputs: [input(1)], deps: deps(vi.fn(async () => jevAnswer(0.8))) });
        expect(again).toMatchObject({ checked: 1, failed: 0 });
    });
});


// A db that serves the person's preference row and records the evidence.
const LEGAL = "2026-11-15";
function turnDb(
    citationCheck: boolean | null,
    extra: { insertError?: { code: string } | null; accepted?: string | null } = {},
) {
    const inserted = memoryDb(extra.insertError ?? null);
    const db = {
        from(table: string) {
            if (table === "user_profiles")
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({
                                data:
                                    citationCheck === null
                                        ? null
                                        : {
                                              citation_check: citationCheck,
                                              terms_accepted_version: extra.accepted === undefined ? LEGAL : extra.accepted,
                                          },
                                error: null,
                            }),
                        }),
                    }),
                };
            if (table === "organizations")
                return {
                    select: () => ({
                        eq: () => ({
                            maybeSingle: async () => ({ data: { id: "org-1", kind: "team" }, error: null }),
                        }),
                    }),
                };
            return (inserted.db as { from: (t: string) => unknown }).from(table);
        },
    } as never;
    return { db, rows: inserted.rows, tables: inserted.tables };
}

describe("createCitationSupportTurn", () => {
    const make = (db: never, fetchImpl = vi.fn(async () => jevAnswer(0.2)), orgId: string | null = "org-1") =>
        createCitationSupportTurn({ db, userId: "u", orgId, surface: "chat", legalVersion: LEGAL, deps: deps(fetchImpl) });

    it("does not exist while the server switch is off or without the platform key: nothing is read, asked or written", async () => {
        const { db, tables } = turnDb(true);
        const fetchImpl = vi.fn();
        for (const [gate, key] of [[undefined, SECRET], ["disabled", SECRET], ["enabled", undefined], ["enabled", "  "], ["true", SECRET]] as const) {
            if (gate === undefined) delete process.env.LITT_CITATION_CHECK;
            else process.env.LITT_CITATION_CHECK = gate;
            if (key === undefined) delete process.env.TYPESAFE_API_KEY;
            else process.env.TYPESAFE_API_KEY = key;
            expect(await make(db, fetchImpl as never)).toBeNull();
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(tables).toEqual([]);
    });

    it("does not exist for a person who opted out", async () => {
        const { db, tables } = turnDb(false);
        expect(await make(db)).toBeNull();
        expect(tables).toEqual([]);
    });

    it("is on for a person who left it on and accepted the current legal version", async () => {
        expect(await make(turnDb(true).db)).not.toBeNull();
    });

    it("never sends a citation of a person who has not accepted the current LEGAL_VERSION (socium-legal C1)", async () => {
        const fetchImpl = vi.fn(async () => jevAnswer(0.2));
        for (const accepted of [null, "", "2026-11-13.2", "2026-11-14", "2026-11-15.2", "old"]) {
            const { db, rows } = turnDb(true, { accepted });
            expect(await make(db, fetchImpl)).toBeNull();
            expect(rows).toEqual([]);
        }
        // No profile row at all: no doubt is resolved in favour of sending.
        expect(await make(turnDb(null).db, fetchImpl)).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
        // The same person, once they accept the current version.
        expect(await make(turnDb(true, { accepted: LEGAL }).db, fetchImpl)).not.toBeNull();
    });

    it("an opt-out wins over an accepted version", async () => {
        expect(await make(turnDb(false, { accepted: LEGAL }).db)).toBeNull();
    });

    it("writes no evidence without a saved answer or without citations", async () => {
        const { db, rows } = turnDb(true);
        const fetchImpl = vi.fn(async () => jevAnswer(0.8));
        const turn = (await make(db, fetchImpl))!;
        expect(await turn.finish("m", true)).toBeNull();
        turn.collect([input(1)]);
        expect(await turn.finish("m", false)).toBeNull();
        expect(await turn.finish(null, true)).toBeNull();
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(rows).toEqual([]);
    });

    it("writes the evidence once the answer is saved, counting the firm and never naming the person", async () => {
        const { db, rows } = turnDb(true);
        const turn = (await make(db))!;
        turn.collect([input(1)]);
        await expect(turn.finish("m1", true)).resolves.toMatchObject({ checked: 1, failed: 0 });
        expect(rows[0]).toMatchObject({ message_id: "m1", organization_id: "org-1", band: "not_supported" });
        expect(JSON.stringify(rows)).not.toContain('"u"');
    });

    it("leaves one sanitized report on failure, never the key, and does not throw", async () => {
        const logs: unknown[][] = [];
        for (const method of ["log", "info", "warn", "error", "debug"] as const)
            vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logs.push(args));
        const { db } = turnDb(true);
        const turn = (await make(db, vi.fn(async () => new Response(`${SECRET} ${CLAIM}`, { status: 401 }))))!;
        turn.collect([input(1), input(2)]);
        await expect(turn.finish("m", true)).resolves.toMatchObject({ checked: 0, failed: 2, firstFailure: "unauthorized" });
        expect(reported.calls).toHaveLength(1);
        const [error, context] = reported.calls[0] as [Error, { level: string; tags: Record<string, unknown> }];
        expect(error.message).toBe("Citation support check had failures: unauthorized");
        expect(context.level).toBe("warning");
        const everything = JSON.stringify({ message: error.message, stack: error.stack, context, logs });
        for (const secret of [SECRET, CLAIM, QUOTE, CONTEXT]) expect(everything).not.toContain(secret);
    });

    it("does not throw when the database does", async () => {
        const db = {
            from: (table: string) => {
                if (table === "user_profiles") return (turnDb(true).db as { from: (t: string) => unknown }).from(table);
                throw new Error(`db exploded with ${SECRET}`);
            },
        } as never;
        const turn = (await make(db))!;
        turn.collect([input(1)]);
        await expect(turn.finish("m", true)).resolves.toBeNull();
        expect(reported.calls).toHaveLength(1);
        expect(JSON.stringify(reported.calls)).not.toContain(SECRET);
    });
});

describe("the other owners of a result", () => {
    const owners = [
        ["tabular_cell", "tabular_cell_id"],
        ["tabular_chat", "tabular_chat_message_id"],
        ["playbook", "playbook_id"],
    ] as const;

    it.each(owners)("writes a %s result against %s and no other owner", async (surface, column) => {
        const { db, rows } = memoryDb();
        await runCitationSupportChecks({
            db,
            apiKey: SECRET,
            scope: { ...SCOPE, surface },
            inputs: [input(1)],
            deps: deps(vi.fn(async () => jevAnswer(0.8))),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ [column]: "message-1" });
        const set = Object.keys(rows[0]).filter((key) => /message_id|^tabular_|^playbook_id/.test(key));
        expect(set).toEqual([column]);
    });

    it("writes nothing but the delete when an owner is forgotten, against that owner's column", async () => {
        const deleted: unknown[] = [];
        const db = {
            from: (table: string) => ({
                delete: () => ({
                    eq: async (column: string, value: unknown) => {
                        deleted.push([table, column, value]);
                        return { error: null };
                    },
                }),
            }),
        } as never;
        await forgetCitationSupportChecks(db, { surface: "tabular_cell", ownerId: "cell-1" });
        expect(deleted).toEqual([["citation_support_checks", "tabular_cell_id", "cell-1"]]);
        const exploding = { from: () => { throw new Error("db down"); } } as never;
        await expect(forgetCitationSupportChecks(exploding, { surface: "tabular_cell", ownerId: "cell-1" })).resolves.toBeUndefined();
    });
});

describe("createCitationSupportRunner", () => {
    it("does not exist without the key, the preference or the accepted version, and reads the firm only when it checks", async () => {
        const fetchImpl = vi.fn(async () => jevAnswer(0.4));
        const { db, rows } = turnDb(true);
        const orgOf = vi.fn(async () => "org-1");
        const runner = await createCitationSupportRunner({ db, userId: "u", orgId: orgOf, legalVersion: LEGAL, deps: deps(fetchImpl) });
        expect(runner).not.toBeNull();
        expect(orgOf).not.toHaveBeenCalled();
        expect(await runner!.run({ surface: "tabular_cell", ownerId: "cell-1" }, [])).toBeNull();
        expect(orgOf).not.toHaveBeenCalled();
        await runner!.run({ surface: "tabular_cell", ownerId: "cell-1" }, [input(1)]);
        await runner!.run({ surface: "playbook", ownerId: "pb-1" }, [input(1)]);
        expect(rows).toMatchObject([
            { organization_id: "org-1", tabular_cell_id: "cell-1", band: "review" },
            { organization_id: "org-1", playbook_id: "pb-1" },
        ]);
        for (const other of [turnDb(false).db, turnDb(true, { accepted: "2026-01-01" }).db]) {
            expect(await createCitationSupportRunner({ db: other, userId: "u", orgId: "org-1", legalVersion: LEGAL, deps: deps(fetchImpl) })).toBeNull();
        }
        delete process.env.TYPESAFE_API_KEY;
        expect(await createCitationSupportRunner({ db, userId: "u", orgId: "org-1", legalVersion: LEGAL })).toBeNull();
    });
});
