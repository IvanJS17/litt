import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "../../__tests__/helpers/memoryDb";
import { getChatTurnNotes } from "./trainingNotes.service";

// Who may open which matter's project: lib/access is the matter rule's owner.
const { openable } = vi.hoisted(() => ({ openable: new Set<string>() }));
vi.mock("../../lib/access", () => ({
    checkProjectAccess: vi.fn(async (projectId: string, userId: string) => ({
        ok: openable.has(`${projectId}:${userId}`),
    })),
}));

const ORG = "00000000-0000-4000-8000-000000000010";
const AUTHOR = "00000000-0000-4000-8000-000000000001";
const MENTOR = "00000000-0000-4000-8000-000000000002";
const FORMER_MENTOR = "00000000-0000-4000-8000-000000000003";
const OTHER_MEMBER = "00000000-0000-4000-8000-000000000004";
const ADMIN = "00000000-0000-4000-8000-000000000005";
const CHAT = "00000000-0000-4000-8000-0000000000c1";
const WORD_CHAT = "00000000-0000-4000-8000-0000000000c2";
const MESSAGE = "00000000-0000-4000-8000-0000000000a1";

const setup = (createdAt = new Date().toISOString()) =>
    memoryDb({
        training_turn_notes: [
            {
                id: "n1",
                org_id: ORG,
                trainee_user_id: AUTHOR,
                chat_id: CHAT,
                message_id: MESSAGE,
                attempt: "x".repeat(60),
                contrast: "Coincide\nNo coincide\nFaltó",
                contrast_status: "ready",
                created_at: createdAt,
            },
            {
                id: "n2",
                org_id: ORG,
                trainee_user_id: AUTHOR,
                word_chat_id: WORD_CHAT,
                message_id: "00000000-0000-4000-8000-0000000000a2",
                attempt: "y".repeat(60),
                contrast: null,
                contrast_status: "pending",
                created_at: createdAt,
            },
        ],
        training_pupils: [{ org_id: ORG, trainee_user_id: AUTHOR, mentor_user_id: MENTOR }],
        chats: [{ id: CHAT, project_id: null, title: null }],
        word_chats: [{ id: WORD_CHAT, title: null }],
    });
const PROJECT = "00000000-0000-4000-8000-0000000000b1";

describe("getChatTurnNotes", () => {
    beforeEach(() => openable.clear());

    it("lets the author read their notes", async () => {
        const { db } = setup();
        const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.notes).toEqual([
            expect.objectContaining({
                id: "n1",
                chat_id: CHAT,
                message_id: MESSAGE,
                attempt: "x".repeat(60),
                contrast: "Coincide\nNo coincide\nFaltó",
                contrast_status: "ready",
            }),
        ]);
    });

    it("finds the notes of a Word chat through its own column", async () => {
        const { db } = setup();
        const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: WORD_CHAT });
        expect(result.ok && result.data.notes.map((n) => n.id)).toEqual(["n2"]);
    });

    it("lets the current mentor read them", async () => {
        const { db } = setup();
        const result = await getChatTurnNotes(db, { actorId: MENTOR, chatId: CHAT });
        expect(result.ok && result.data.notes[0].attempt).toBe("x".repeat(60));
    });

    it.each([
        ["another member of the organization", OTHER_MEMBER],
        ["an owner or admin who is not the mentor", ADMIN],
        ["the former mentor, once the pupil has another", FORMER_MENTOR],
    ])("answers %s the same 404 as for an unknown chat", async (_label, actorId) => {
        const { db, tables } = setup();
        tables.training_pupils.push({ org_id: ORG, trainee_user_id: OTHER_MEMBER, mentor_user_id: FORMER_MENTOR });
        const denied = await getChatTurnNotes(db, { actorId, chatId: CHAT });
        const unknown = await getChatTurnNotes(db, {
            actorId,
            chatId: "00000000-0000-4000-8000-0000000000ff",
        });
        expect(denied).toMatchObject({ ok: false, kind: "not_found" });
        expect(denied).toEqual(unknown);
    });

    it("stops serving the mentor once the pupil is released or reassigned", async () => {
        const { db, tables } = setup();
        tables.training_pupils[0].mentor_user_id = FORMER_MENTOR;
        expect(await getChatTurnNotes(db, { actorId: MENTOR, chatId: CHAT })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
        tables.training_pupils.length = 0;
        expect(await getChatTurnNotes(db, { actorId: FORMER_MENTOR, chatId: CHAT })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
    });

    it("does not extend a mentor of another organization to this one", async () => {
        const { db, tables } = setup();
        tables.training_pupils[0].org_id = "00000000-0000-4000-8000-000000000099";
        expect(await getChatTurnNotes(db, { actorId: MENTOR, chatId: CHAT })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
    });

    it("serves a mentor a chat inside a matter only while they can open the matter", async () => {
        const { db, tables } = setup();
        tables.chats[0].project_id = PROJECT;
        const unknown = await getChatTurnNotes(db, {
            actorId: MENTOR,
            chatId: "00000000-0000-4000-8000-0000000000ff",
        });
        const denied = await getChatTurnNotes(db, { actorId: MENTOR, actorEmail: null, chatId: CHAT });
        expect(denied).toEqual(unknown);
        // The author keeps their own notes; the mentor reads them once let in.
        expect((await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT })).ok).toBe(true);
        openable.add(`${PROJECT}:${MENTOR}`);
        const allowed = await getChatTurnNotes(db, { actorId: MENTOR, chatId: CHAT });
        expect(allowed.ok && allowed.data.notes.map((n) => n.id)).toEqual(["n1"]);
    });

    it("narrows to one message and rejects malformed ids with the same 404", async () => {
        const { db } = setup();
        const other = await getChatTurnNotes(db, {
            actorId: AUTHOR,
            chatId: CHAT,
            messageId: "00000000-0000-4000-8000-0000000000ee",
        });
        expect(other).toMatchObject({ ok: false, kind: "not_found" });
        expect(await getChatTurnNotes(db, { actorId: AUTHOR, chatId: "nope" })).toMatchObject({
            ok: false,
            kind: "not_found",
        });
        expect(
            await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT, messageId: "nope" }),
        ).toMatchObject({ ok: false, kind: "not_found" });
    });

    it("reports a contrast that stayed pending too long as failed", async () => {
        const { db } = setup("2026-01-01T00:00:00Z");
        const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: WORD_CHAT });
        expect(result.ok && result.data.notes[0]).toMatchObject({
            contrast: null,
            contrast_status: "failed",
        });
    });

    it("fails with an error, not a 404, when the notes cannot be read", async () => {
        const { db, failNext } = setup();
        failNext("training_turn_notes", "select", { message: "down" });
        expect(await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT })).toMatchObject({
            ok: false,
            kind: "error",
        });
    });

    describe("layer 3: the thermometer mark, the verdict and the basis", () => {
        const judged = {
            confidence: 4,
            verdict: "coincide",
            verdict_source: "contrast",
            foundation: "wrong",
            foundation_question: "¿En qué se apoya tu conclusión?",
            topics: ["rescisión"],
            answer_unverified: false,
        };

        it("shows the author and the current mentor the fields, with the verdict that counts", async () => {
            for (const actorId of [AUTHOR, MENTOR]) {
                const { db, tables } = setup();
                Object.assign(tables.training_turn_notes[0], judged);
                const result = await getChatTurnNotes(db, { actorId, chatId: CHAT });
                expect(result.ok && result.data.notes[0]).toMatchObject({
                    confidence: 4,
                    verdict: "coincide",
                    verdict_source: "contrast",
                    // The conclusion matched, the reasoning did not.
                    effective_verdict: "parcial",
                    right_for_wrong_reason: true,
                    foundation: "wrong",
                    foundation_question: "¿En qué se apoya tu conclusión?",
                    topics: ["rescisión"],
                    answer_unverified: false,
                });
            }
        });

        it("counts a mentor's correction as written", async () => {
            const { db, tables } = setup();
            Object.assign(tables.training_turn_notes[0], judged, { verdict_source: "mentor" });
            const result = await getChatTurnNotes(db, { actorId: MENTOR, chatId: CHAT });
            expect(result.ok && result.data.notes[0]).toMatchObject({
                verdict_source: "mentor",
                effective_verdict: "coincide",
                right_for_wrong_reason: false,
            });
        });

        it("flags a turn whose answer carried an unverified citation", async () => {
            const { db, tables } = setup();
            Object.assign(tables.training_turn_notes[0], judged, { answer_unverified: true });
            const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT });
            expect(result.ok && result.data.notes[0].answer_unverified).toBe(true);
        });

        it("reads a note of layers 1 and 2 exactly as before: none of the new fields", async () => {
            const { db, tables } = setup();
            Object.assign(tables.training_turn_notes[0], {
                confidence: null, verdict: null, verdict_source: null, foundation: null,
                foundation_question: null, topics: null, answer_unverified: false, mode: null, step: null,
            });
            const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT });
            expect(result.ok && Object.keys(result.data.notes[0]).sort()).toEqual(
                ["attempt", "chat_id", "contrast", "contrast_status", "created_at", "id", "message_id", "org_id", "trainee_user_id"],
            );
        });

        it("reads a skipped note as skipped, forever", async () => {
            const { db, tables } = setup("2020-01-01T00:00:00Z");
            Object.assign(tables.training_turn_notes[0], { contrast_status: "skipped", contrast: null });
            const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT });
            expect(result.ok && result.data.notes[0].contrast_status).toBe("skipped");
        });

        // Learning data: the same readers as the rest of the note, no more.
        it.each([
            ["another member", OTHER_MEMBER],
            ["an owner or admin who is not the mentor", ADMIN],
            ["the former mentor", FORMER_MENTOR],
        ])("keeps them from %s: the same 404", async (_label, actorId) => {
            const { db, tables } = setup();
            Object.assign(tables.training_turn_notes[0], judged);
            tables.training_pupils.push({ org_id: ORG, trainee_user_id: OTHER_MEMBER, mentor_user_id: FORMER_MENTOR });
            const denied = await getChatTurnNotes(db, { actorId, chatId: CHAT });
            expect(denied).toMatchObject({ ok: false, kind: "not_found" });
            expect(JSON.stringify(denied)).not.toContain("rescisión");
        });

        it("carries no score, rank, average or percentile", async () => {
            const { db, tables } = setup();
            Object.assign(tables.training_turn_notes[0], judged);
            const result = await getChatTurnNotes(db, { actorId: AUTHOR, chatId: CHAT });
            expect(Object.keys(result.ok ? result.data.notes[0] : {}).join(" ")).not.toMatch(/score|rank|average|percentile|total/);
        });
    });
});
