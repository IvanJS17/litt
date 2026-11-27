import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCitationSupportRunner, type CitationSupportSurface } from "../check";
import {
    DEFAULT_DAILY_MAX_PER_PERSON,
    citationCheckCounterSize,
    dailyMaxPerPerson,
    resetCitationCheckCounter,
    takeCitationChecks,
} from "../dailyNumber";
import type { CitationSupportInput } from "../inputs";

// The real service and database are never touched: both are stand-ins. The real
// reporter is used, and the lines it writes to the console are captured.
const LEGAL = "2026-11-15";
const PERSON_A = "person-aaaa-secret-id";
const PERSON_B = "person-bbbb-secret-id";
const ORG = "org-secret-id";

// Mexico City is six hours behind UTC all year: these instants fall on the same UTC day
// but on different Mexico City days (and the last pair the other way round).
const LATE_EVENING_MX = new Date("2026-11-10T05:30:00Z"); // 2026-11-09 23:30 in Mexico City
const AFTER_MIDNIGHT_MX = new Date("2026-11-10T06:30:00Z"); // 2026-11-10 00:30 in Mexico City
const EVENING_MX = new Date("2026-11-10T23:30:00Z"); // 2026-11-10 17:30 in Mexico City
const SAME_MX_DAY_NEXT_UTC_DAY = new Date("2026-11-11T01:00:00Z"); // 2026-11-10 19:00 in Mexico City

const input = (ref: number): CitationSupportInput => ({
    ref,
    documentId: "11111111-1111-4111-8111-111111111111",
    versionId: "22222222-2222-4222-8222-222222222222",
    startChar: 10,
    endChar: 40,
    state: { afirmacion: `claim ${ref}`, cita: "quote", contexto: "context" },
});
const inputs = (n: number) => Array.from({ length: n }, (_, i) => input(i + 1));

const ok = () =>
    new Response(
        JSON.stringify({ model: "jev-1.14.0", answers: { respalda: { type: "noul", noul: 0.4 } }, usage: { input_tokens: 900, output_tokens: 3 } }),
        { status: 200, headers: { "content-type": "application/json" } },
    );

function setup(answer: () => Response = ok) {
    const rows: Record<string, unknown>[] = [];
    const tables: string[] = [];
    const fetchImpl = vi.fn(async () => answer());
    const db = {
        from(table: string) {
            tables.push(table);
            if (table === "user_profiles")
                return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { citation_check: true, terms_accepted_version: LEGAL }, error: null }) }) }) };
            if (table === "organizations")
                return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: ORG, kind: "team" }, error: null }) }) }) };
            return {
                insert: async (row: Record<string, unknown>) => {
                    rows.push(row);
                    return { error: null };
                },
            };
        },
    } as never;
    const runnerFor = async (userId: string) =>
        (await createCitationSupportRunner({
            db,
            userId,
            orgId: ORG,
            legalVersion: LEGAL,
            deps: { fetch: fetchImpl as unknown as typeof fetch, sleep: async () => undefined },
        }))!;
    const answer1 = async (userId: string, n: number, surface: CitationSupportSurface = "chat") =>
        (await runnerFor(userId)).run({ surface, ownerId: "owner-1" }, inputs(n));
    return { rows, tables, fetchImpl, runnerFor, answer1 };
}

let lines: string[];
beforeEach(() => {
    process.env.LITT_CITATION_CHECK = "enabled";
    process.env.TYPESAFE_API_KEY = "synthetic-typesafe-key-0007";
    process.env.LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON = "5";
    resetCitationCheckCounter();
    lines = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LATE_EVENING_MX);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const name of ["LITT_CITATION_CHECK", "TYPESAFE_API_KEY", "LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON"]) delete process.env[name];
});

const warningLines = () => lines.filter((l) => l.includes("citation_support.daily_number_reached"));

describe("the daily number of citation checks per person", () => {
    it("sends only what is left of the person's number, writes nothing for the rest, and leaves others alone", async () => {
        const t = setup();
        expect(await t.answer1(PERSON_A, 3)).toMatchObject({ checked: 3 });
        expect(t.fetchImpl).toHaveBeenCalledTimes(3);
        expect(t.rows).toHaveLength(3);

        expect(await t.answer1(PERSON_A, 4)).toMatchObject({ checked: 2 });
        expect(t.fetchImpl).toHaveBeenCalledTimes(5);
        expect(t.rows.map((r) => r.citation_ref)).toEqual(expect.arrayContaining([1, 2, 3]));
        expect(t.rows).toHaveLength(5);
        // The first citations in order are the ones sent: of the second answer, refs 1 and 2.
        expect(t.fetchImpl.mock.calls.slice(3).map((c) => (c as unknown as [string, RequestInit])[1].body as string).map((b) => JSON.parse(b).state.afirmacion).sort()).toEqual(["claim 1", "claim 2"]);

        const tablesBefore = t.tables.length;
        expect(await t.answer1(PERSON_A, 2)).toBeNull();
        expect(t.fetchImpl).toHaveBeenCalledTimes(5);
        expect(t.rows).toHaveLength(5);
        expect(t.tables.slice(tablesBefore)).not.toContain("citation_support_checks");

        expect(await t.answer1(PERSON_B, 4)).toMatchObject({ checked: 4 });
        expect(t.fetchImpl).toHaveBeenCalledTimes(9);
        expect(t.rows).toHaveLength(9);
    });

    it("counts a request that was sent and failed", async () => {
        const t = setup(() => new Response("{}", { status: 400 }));
        expect(await t.answer1(PERSON_A, 3)).toMatchObject({ checked: 0, failed: 3 });
        expect(t.fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
        const sent = t.fetchImpl.mock.calls.length;
        await t.answer1(PERSON_A, 4);
        // Only the two left were asked about, the other two citations were not.
        const asked = (from: number) => new Set(t.fetchImpl.mock.calls.slice(from).map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string).state.afirmacion));
        expect(asked(sent)).toEqual(new Set(["claim 1", "claim 2"]));
        const after = t.fetchImpl.mock.calls.length;
        await t.answer1(PERSON_A, 1);
        expect(t.fetchImpl.mock.calls.length).toBe(after);
    });

    it("decides how many to send before sending", async () => {
        const t = setup();
        const both = Promise.all([t.answer1(PERSON_A, 4), t.answer1(PERSON_A, 4)]);
        await both;
        expect(t.fetchImpl).toHaveBeenCalledTimes(5);
        expect(t.rows).toHaveLength(5);
    });

    it("starts a new number on the next day in Mexico City, not in UTC, and drops yesterday's entries", async () => {
        const t = setup();
        await t.answer1(PERSON_A, 5);
        await t.answer1(PERSON_B, 1);
        expect(citationCheckCounterSize()).toBe(2);
        expect(await t.answer1(PERSON_A, 1)).toBeNull();

        vi.setSystemTime(AFTER_MIDNIGHT_MX); // same UTC day, next day in Mexico City
        expect(await t.answer1(PERSON_A, 2)).toMatchObject({ checked: 2 });
        expect(citationCheckCounterSize()).toBe(1);
        await t.answer1(PERSON_A, 3);
        expect(await t.answer1(PERSON_A, 1)).toBeNull();
    });

    it("keeps the count while the UTC day changes but the Mexico City day does not", async () => {
        const t = setup();
        vi.setSystemTime(EVENING_MX);
        await t.answer1(PERSON_A, 5);
        vi.setSystemTime(SAME_MX_DAY_NEXT_UTC_DAY);
        expect(await t.answer1(PERSON_A, 1)).toBeNull();
        expect(t.fetchImpl).toHaveBeenCalledTimes(5);
    });

    it("below the number every surface sends and writes exactly what it did before", async () => {
        const t = setup();
        const columns: Record<CitationSupportSurface, string> = {
            chat: "message_id",
            word: "word_message_id",
            tabular_cell: "tabular_cell_id",
            tabular_chat: "tabular_chat_message_id",
            playbook: "playbook_id",
        };
        for (const [surface, column] of Object.entries(columns)) {
            t.rows.length = 0;
            t.fetchImpl.mockClear();
            resetCitationCheckCounter();
            expect(await t.answer1(PERSON_A, 5, surface as CitationSupportSurface)).toEqual({ checked: 5, failed: 0, firstFailure: null });
            expect(t.fetchImpl).toHaveBeenCalledTimes(5);
            expect(t.rows).toHaveLength(5);
            expect(t.rows[0]).toMatchObject({ organization_id: ORG, [column]: "owner-1", band: "review" });
        }
        expect(warningLines()).toEqual([]);
    });
});

describe("the setting", () => {
    it("is 2,000 by default and overridden by LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON", () => {
        expect(DEFAULT_DAILY_MAX_PER_PERSON).toBe(2_000);
        expect(dailyMaxPerPerson({})).toBe(2_000);
        expect(dailyMaxPerPerson({ LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON: "40" })).toBe(40);
    });

    it("falls back to the default for an empty, zero, negative or non-numeric value, and stops at a ceiling of 1,000,000", () => {
        for (const bad of ["", "0", "-3", "abc", "NaN", "5abc", "1e9", "2.5", "0x10", "07", "Infinity"]) expect(dailyMaxPerPerson({ LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON: bad })).toBe(2_000);
        expect(dailyMaxPerPerson({ LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON: "99999999999" })).toBe(1_000_000);
        expect(dailyMaxPerPerson({ LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON: "1000000" })).toBe(1_000_000);
    });

    it("applies to the next check without a restart of the counter", () => {
        delete process.env.LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON;
        expect(takeCitationChecks(PERSON_A, 2_500)).toBe(2_000);
        expect(takeCitationChecks(PERSON_A, 1)).toBe(0);
    });
});

describe("the warning", () => {
    it("is one line per process and day for everybody, and names no person, organization or address", async () => {
        const t = setup();
        await t.answer1(PERSON_A, 9);
        await t.answer1(PERSON_A, 1);
        await t.answer1(PERSON_B, 9);
        expect(warningLines()).toHaveLength(1);
        const [line] = warningLines();
        expect(line).toContain("citation-support");
        for (const secret of [PERSON_A, PERSON_B, ORG, "@", "owner-1", "claim"]) expect(line).not.toContain(secret);

        vi.setSystemTime(AFTER_MIDNIGHT_MX);
        await t.answer1(PERSON_A, 9);
        await t.answer1(PERSON_B, 9);
        expect(warningLines()).toHaveLength(2);
    });

    it("is not written when nobody reaches the number", async () => {
        const t = setup();
        await t.answer1(PERSON_A, 5);
        expect(warningLines()).toEqual([]);
    });
});
