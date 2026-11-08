import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";
import { memoryDb, type Row } from "../../__tests__/helpers/memoryDb";
import { NOTE_NOT_JUDGEABLE_CODE, overrideNoteVerdict } from "./trainingCriterion.service";
import { pupilNotesRouter } from "./trainingCriterion.routes";

// Who may open which matter's project: lib/access owns the matter rule.
const { openable } = vi.hoisted(() => ({ openable: new Set<string>() }));
vi.mock("../../lib/access", () => ({
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) => ({
        ok: openable.has(`${projectId}:${userId}`),
    })),
}));

const ORG = "00000000-0000-4000-8000-000000000010";
const OTHER_ORG = "00000000-0000-4000-8000-000000000011";
const PUPIL = "00000000-0000-4000-8000-000000000001";
const MENTOR = "00000000-0000-4000-8000-000000000002";
const FORMER_MENTOR = "00000000-0000-4000-8000-000000000003";
const OTHER_MEMBER = "00000000-0000-4000-8000-000000000004";
const OWNER = "00000000-0000-4000-8000-000000000005";
const ADMIN = "00000000-0000-4000-8000-000000000006";
const OTHER_PUPIL = "00000000-0000-4000-8000-000000000007";
const OUTSIDER = "00000000-0000-4000-8000-000000000008";
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const WORD_CHAT = "00000000-0000-4000-8000-0000000000c2";
const PROJECT = "00000000-0000-4000-8000-0000000000b1";
const NOTE = "00000000-0000-4000-8000-0000000000a1";
const HINT_NOTE = "00000000-0000-4000-8000-0000000000a2";
const WORD_NOTE = "00000000-0000-4000-8000-0000000000a3";

// The database rule (training_can_read_learning) is proven in PostgreSQL by
// performance.litt-training-supervision.sql: the pupil and their CURRENT
// mentor, nobody else. This stub is the same rule, so the matrix below pins
// the service's use of it (owner and admin are members of the firm and are
// still refused).
function setup(extra: Record<string, Row[]> = {}) {
    const tables: Record<string, Row[]> = {
        training_pupils: [
            { org_id: ORG, trainee_user_id: PUPIL, mentor_user_id: MENTOR },
            { org_id: ORG, trainee_user_id: OTHER_PUPIL, mentor_user_id: FORMER_MENTOR },
        ],
        org_members: [
            { org_id: ORG, user_id: OWNER, role: "owner" },
            { org_id: ORG, user_id: ADMIN, role: "admin" },
            { org_id: ORG, user_id: OTHER_MEMBER, role: "member" },
        ],
        training_turn_notes: [
            { id: NOTE, org_id: ORG, trainee_user_id: PUPIL, chat_id: CHAT, contrast_status: "ready", mode: null, foundation: "wrong", verdict: "coincide", verdict_source: "contrast", verdict_by: null },
            { id: HINT_NOTE, org_id: ORG, trainee_user_id: PUPIL, chat_id: CHAT, contrast_status: "skipped", mode: "hint", foundation: null, verdict: null, verdict_source: null, verdict_by: null },
            { id: WORD_NOTE, org_id: ORG, trainee_user_id: PUPIL, word_chat_id: WORD_CHAT, contrast_status: "ready", mode: null, foundation: null, verdict: "no_coincide", verdict_source: "contrast", verdict_by: null },
        ],
        chats: [{ id: CHAT, project_id: PROJECT, title: "t" }],
        word_chats: [{ id: WORD_CHAT, title: "t" }],
        audit_events: [],
        ...extra,
    };
    const memory: ReturnType<typeof memoryDb> = memoryDb(tables, {
        training_can_read_learning: (args) => {
            const { p_actor, p_org, p_trainee } = args as { p_actor: string; p_org: string; p_trainee: string };
            const pupils = memory.tables.training_pupils;
            return p_actor === p_trainee
                ? pupils.some((p) => p.org_id === p_org && p.trainee_user_id === p_trainee)
                : pupils.some((p) => p.org_id === p_org && p.trainee_user_id === p_trainee && p.mentor_user_id === p_actor);
        },
    });
    return { ...memory, db: memory.db as Db };
}

const NOT_FOUND = { ok: false, kind: "not_found", detail: "Training data not found" };
const call = (db: Db, over: Partial<Parameters<typeof overrideNoteVerdict>[1]> = {}) =>
    overrideNoteVerdict(db, {
        actorId: MENTOR,
        orgId: ORG,
        traineeId: PUPIL,
        noteId: NOTE,
        body: { verdict: "no_coincide" },
        ...over,
    });

describe("the mentor corrects a verdict", () => {
    beforeEach(() => {
        openable.clear();
        openable.add(`${PROJECT}:${MENTOR}`);
    });

    it("sets the mentor's verdict, who set it, and what it counts as", async () => {
        const { db, tables } = setup();
        const result = await call(db, { body: { verdict: "coincide" } });
        // A mentor's coincide counts as written even where the contrast's would be parcial.
        expect(result).toEqual({
            ok: true,
            data: { id: NOTE, verdict: "coincide", verdict_source: "mentor", effective_verdict: "coincide" },
        });
        expect(tables.training_turn_notes[0]).toMatchObject({ verdict: "coincide", verdict_source: "mentor", verdict_by: MENTOR });
        // Nothing else changed: the other notes of the pupil are as they were.
        expect(tables.training_turn_notes[1]).toMatchObject({ verdict: null, verdict_source: null });
        expect(tables.training_turn_notes[2]).toMatchObject({ verdict: "no_coincide", verdict_source: "contrast" });
    });

    it("corrects a Word note, which belongs to no matter", async () => {
        const { db } = setup();
        expect(await call(db, { noteId: WORD_NOTE, body: { verdict: "parcial" } })).toMatchObject({ ok: true });
    });

    // The role matrix of the route: only the pupil's current mentor.
    it.each([
        ["the pupil themself", PUPIL],
        ["the pupil's former mentor", FORMER_MENTOR],
        ["another member", OTHER_MEMBER],
        ["the owner", OWNER],
        ["an admin", ADMIN],
        ["another pupil", OTHER_PUPIL],
        ["somebody outside the firm", OUTSIDER],
        ["nobody", undefined],
    ])("answers the same 404 to %s, and changes nothing", async (_who, actor) => {
        const { db, tables } = setup();
        const before = JSON.stringify(tables.training_turn_notes);
        expect(await call(db, { actorId: actor as string })).toEqual(NOT_FOUND);
        expect(JSON.stringify(tables.training_turn_notes)).toBe(before);
        expect(tables.audit_events).toHaveLength(0);
    });

    it("answers the same 404 to a wrong organization, a wrong pupil, a malformed id and a note that does not exist", async () => {
        for (const over of [
            { orgId: OTHER_ORG },
            { traineeId: OTHER_PUPIL },
            { noteId: "nope" },
            { noteId: undefined },
            { noteId: "00000000-0000-4000-8000-0000000000ff" },
            { orgId: [ORG] },
        ]) {
            const { db, tables } = setup();
            expect(await call(db, over)).toEqual(NOT_FOUND);
            expect(tables.audit_events).toHaveLength(0);
        }
    });

    it("does not read a work inside a matter the mentor cannot open", async () => {
        openable.clear();
        const { db, tables } = setup();
        expect(await call(db)).toEqual(NOT_FOUND);
        expect(tables.training_turn_notes[0]).toMatchObject({ verdict: "coincide", verdict_source: "contrast" });
    });

    it.each([[undefined], [{}], [{ verdict: "mal" }], [{ verdict: 1 }], [{ verdict: "coincide " }], [null]])(
        "refuses a body without one of the three verdicts (%j)",
        async (body) => {
            const { db, tables } = setup();
            expect(await call(db, { body })).toMatchObject({ ok: false, kind: "validation" });
            expect(tables.training_turn_notes[0].verdict_source).toBe("contrast");
        },
    );

    it("refuses to judge a turn with nothing to compare, on its own code", async () => {
        const { db, tables } = setup();
        expect(await call(db, { noteId: HINT_NOTE })).toEqual({
            ok: false,
            kind: "conflict",
            detail: expect.any(String),
            code: NOTE_NOT_JUDGEABLE_CODE,
        });
        expect(tables.training_turn_notes[1].verdict).toBeNull();
    });

    it("fails closed when the database cannot tell who may read", async () => {
        const { db } = setup();
        const broken = { ...db, rpc: async () => ({ data: null, error: { message: "down" } }) } as unknown as Db;
        expect(await call(broken)).toMatchObject({ ok: false, kind: "error" });
    });
});

describe("the audit of a corrected verdict", () => {
    beforeEach(() => {
        openable.clear();
        openable.add(`${PROJECT}:${MENTOR}`);
    });

    // Insert-only and free of learning data: identifiers only. Not the
    // verdict, not the old one, not a topic, not the attempt.
    it("is one event with only identifiers, and never the verdict", async () => {
        const { db, tables } = setup();
        await call(db, { body: { verdict: "parcial" } });
        expect(tables.audit_events).toHaveLength(1);
        const event = tables.audit_events[0] as Record<string, unknown>;
        expect(event).toMatchObject({
            user_id: MENTOR,
            org_id: ORG,
            action: "training.verdict_overridden",
            surface: "organization",
            chat_id: CHAT,
        });
        expect(Object.keys(event.detail as object).sort()).toEqual(["org_id", "target_user_id"]);
        expect(event.detail).toEqual({ org_id: ORG, target_user_id: PUPIL });
        const text = JSON.stringify(event);
        for (const learning of ["parcial", "coincide", "foundation", "topics", "confidence", "attempt"])
            expect(text).not.toContain(learning);
    });
});

// Every route of the new router has a row here; a route added without one
// fails this test, so no route ships unconsidered.
describe("every route of the criterion router", () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: { name?: string } }[] } };
    const routes = ((pupilNotesRouter as unknown as { stack: Layer[] }).stack)
        .filter((layer) => layer.route)
        .map((layer) => `${Object.keys(layer.route!.methods).join(",").toUpperCase()} ${layer.route!.path}`);

    // route → who reads or writes it: the pupil's current mentor only.
    const MATRIX: Record<string, "current-mentor"> = {
        "PUT /:noteId/verdict": "current-mentor",
    };

    it("is covered by the role matrix", () => {
        expect(routes.sort()).toEqual(Object.keys(MATRIX).sort());
    });

    it("answers with the note's own fields, no score, rank, average or percentile", async () => {
        openable.add(`${PROJECT}:${MENTOR}`);
        const { db } = setup();
        const result = await call(db);
        expect(JSON.stringify(result)).not.toMatch(/score|rank|average|percentile|total/i);
    });
});
