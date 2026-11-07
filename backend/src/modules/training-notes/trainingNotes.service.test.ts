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
});
