import { describe, expect, it } from "vitest";
import { buildUserAccountExport, buildUserChatsExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// A Word chat's answers are copies of what they read or cite, like any other
// chat's. The export leaves one out once the holder can no longer open its
// sources, and so a training record made from it; what the holder typed, and
// answers drawn only from the document open in Word or from documents the
// holder can still open, leave exactly as stored.
const holder = "associate";
const email = "associate@example.test";
const DOC_OWN = "00000000-0000-4000-8000-0000000000a1";
const DOC_UNSHARED = "00000000-0000-4000-8000-0000000000a2";
const DOC_DELETED = "00000000-0000-4000-8000-0000000000a3";
const OPEN_WORD_DOCUMENT = "active-word-document";

const message = (id: string, chat: string, role: string, n: number, over: Row = {}): Row => ({
    id,
    chat_id: chat,
    role,
    content: role === "user" ? `TYPED-${id}` : [{ type: "content", text: `ANSWER-${id}` }],
    files: null,
    citations: null,
    created_at: `2026-02-01T00:00:${String(10 + n)}Z`,
    ...over,
});
const snapshotRead = { type: "doc_read", filename: "Contract.docx", document_id: null, version_id: null, version_number: null };
const answer = (id: string, chat: string, n: number, events: Row[], citations: Row[] | null = null) =>
    message(id, chat, "assistant", n, { content: [...events, { type: "content", text: `ANSWER-${id}` }], citations });

function world(): Record<string, Row[]> {
    return {
        documents: [
            { id: DOC_OWN, user_id: holder, project_id: null, org_id: null, archived_at: null },
            // Shared with the holder once; the share is gone.
            { id: DOC_UNSHARED, user_id: "colleague", project_id: null, org_id: null, archived_at: null },
        ],
        word_documents: [{ id: "wd", user_id: holder, created_at: "2026-02-01T00:00:00Z" }],
        word_chats: [
            { id: "ordinary", user_id: holder, word_document_id: "wd", title: "TITLE-ordinary", created_at: "2026-02-01T00:00:00Z" },
            { id: "mixed", user_id: holder, word_document_id: "wd", title: "TITLE-mixed", created_at: "2026-02-01T00:00:01Z" },
        ],
        word_chat_messages: [
            // The ordinary case: the open document, a document of the holder's own, the holder's typing.
            message("o-u1", "ordinary", "user", 1, { files: [{ filename: "own.docx", document_id: DOC_OWN }] }),
            answer("o-a1", "ordinary", 2, [snapshotRead, { type: "doc_read", filename: "own.docx", document_id: DOC_OWN }], [
                { type: "citation_data", document_id: OPEN_WORD_DOCUMENT, quote: "q" },
                { type: "citation_data", document_id: DOC_OWN, quote: "q" },
            ]),
            message("o-u2", "ordinary", "user", 3),
            answer("o-a2", "ordinary", 4, [snapshotRead]),
            // A chat with one answer kept and others withheld.
            message("m-u1", "mixed", "user", 1),
            answer("m-a1", "mixed", 2, [snapshotRead]),
            message("m-u2", "mixed", "user", 3, { files: [{ filename: "UNSHARED-NAME.docx", document_id: DOC_UNSHARED }] }),
            answer("m-a2", "mixed", 4, [{ type: "doc_read", filename: "unshared.docx", document_id: DOC_UNSHARED }], [{ type: "citation_data", document_id: DOC_UNSHARED, quote: "QUOTE-UNSHARED" }]),
        ],
    };
}

const ids = (rows: Row[]) => rows.map((row) => row.id as string);
const exported = async (tables: Record<string, Row[]>) => (await buildUserChatsExport(makeExportDb(tables).db, holder, email, null)).word_addin_chats;

describe("export of Word chats: answers whose sources the holder can no longer open", () => {
    it("leaves the answers of a chat with an unshared source out and keeps the holder's typing", async () => {
        const out = await exported(world());
        expect(ids(out.messages).filter((id) => id.startsWith("m-"))).toEqual(["m-u1", "m-a1", "m-u2"]);
        const typed = out.messages.find((row) => row.id === "m-u2")!;
        expect(typed.content).toBe("TYPED-m-u2");
        expect(typed.files).toEqual([]);
        expect(JSON.stringify(out)).not.toMatch(/UNSHARED-NAME|QUOTE-UNSHARED|ANSWER-m-a2/);
    });

    it("leaves the chat's title out when anything of the chat was withheld", async () => {
        const chats = Object.fromEntries((await exported(world())).chats.map((chat) => [chat.id as string, chat]));
        expect(chats.mixed.title).toBeNull();
        expect(chats.ordinary.title).toBe("TITLE-ordinary");
    });

    it("leaves out an answer whose source was deleted, and one that names a document it cannot identify", async () => {
        const tables = world();
        tables.word_chat_messages = [
            message("d-u1", "mixed", "user", 1),
            answer("d-a1", "mixed", 2, [{ type: "doc_read", filename: "gone.docx", document_id: DOC_DELETED }]),
            answer("d-a2", "mixed", 3, [{ type: "doc_read", filename: "legacy.docx" }]),
            answer("d-a3", "mixed", 4, []),
        ];
        const out = await exported(tables);
        expect(ids(out.messages)).toEqual(["d-u1"]);
    });

    it("keeps an answer that recorded no source at all", async () => {
        const tables = world();
        tables.word_chat_messages = [message("n-u1", "mixed", "user", 1), answer("n-a1", "mixed", 2, [])];
        expect(ids((await exported(tables)).messages)).toEqual(["n-u1", "n-a1"]);
    });

    it("exports an ordinary chat exactly as stored", async () => {
        const tables = world();
        const out = await exported(tables);
        const stored = tables.word_chat_messages.filter((row) => row.chat_id === "ordinary");
        expect(out.messages.filter((row) => row.chat_id === "ordinary")).toEqual(stored);
        expect(out.chats.find((chat) => chat.id === "ordinary")).toEqual(tables.word_chats[0]);
        expect(out.documents).toEqual(tables.word_documents);
    });

    it("returns the answers once the holder can open the source again", async () => {
        const tables = world();
        tables.documents[1].user_id = holder;
        expect(ids((await exported(tables)).messages).filter((id) => id.startsWith("m-"))).toEqual(["m-u1", "m-a1", "m-u2", "m-a2"]);
    });
});

describe("account export: training records made from a Word chat follow its answers", () => {
    const row = (id: string, over: Row = {}): Row => ({
        id, org_id: "org", trainee_user_id: holder, chat_id: null, word_chat_id: "mixed", tabular_chat_id: null,
        created_at: "2026-02-02T00:00:00Z", ...over,
    });
    function withRecords(): Record<string, Row[]> {
        return {
            ...world(),
            organizations: [{ id: "org", kind: "team" }],
            org_members: [{ org_id: "org", user_id: holder, role: "member" }],
            training_turn_notes: [
                row("tn-kept", { message_id: "m-u1", attempt: "A", contrast: "CONTRAST-kept", contrast_status: "ready" }),
                row("tn-withheld", { message_id: "m-u2", attempt: "A", contrast: "CONTRAST-withheld", contrast_status: "ready" }),
                row("tn-ordinary", { word_chat_id: "ordinary", message_id: "o-u1", attempt: "A", contrast: "CONTRAST-ordinary", contrast_status: "ready" }),
            ],
            training_backing_checks: [
                row("bk-kept", { message_id: "m-a1", status: "ready", conclusions: ["CONCLUSION-kept"] }),
                row("bk-withheld", { message_id: "m-a2", status: "ready", conclusions: ["CONCLUSION-withheld"] }),
            ],
            training_work_reviews: [
                row("wr-mixed", { status: "ready", proposed: ["PROPOSED-mixed"] }),
                row("wr-ordinary", { word_chat_id: "ordinary", status: "ready", proposed: ["PROPOSED-ordinary"] }),
            ],
        };
    }
    const training = async (tables: Record<string, Row[]>, orgId: string | null) =>
        ((await buildUserAccountExport(makeExportDb(tables).db, holder, email, orgId)) as any).training;

    it.each([["the firm's workspace", "org"], ["Personal", null]])("leaves out what came from a withheld answer in %s", async (_name, orgId) => {
        const t = await training(withRecords(), orgId as string | null);
        expect(ids(t.turn_notes)).toEqual(["tn-kept", "tn-ordinary"]);
        expect(ids(t.backing_checks)).toEqual(["bk-kept"]);
        // A review records only the chat: it stays only if every answer of the chat is readable.
        expect(ids(t.work_reviews)).toEqual(["wr-ordinary"]);
        expect(JSON.stringify(t)).not.toMatch(/(CONTRAST|CONCLUSION|PROPOSED)-(withheld|mixed)/);
    });

    it("keeps every record once the holder can open the source again", async () => {
        const tables = withRecords();
        tables.documents[1].user_id = holder;
        const t = await training(tables, "org");
        expect(ids(t.turn_notes)).toEqual(["tn-kept", "tn-ordinary", "tn-withheld"]);
        expect(ids(t.work_reviews)).toEqual(["wr-mixed", "wr-ordinary"]);
    });

    it("keeps a record of a Word chat that has no stored message", async () => {
        const tables = withRecords();
        tables.word_chats.push({ id: "empty", user_id: holder, word_document_id: "wd", title: null, created_at: "2026-02-01T00:00:09Z" });
        tables.training_turn_notes.push(row("tn-empty", { word_chat_id: "empty", message_id: "x", attempt: "A", contrast: "C", contrast_status: "ready" }));
        expect(ids((await training(tables, "org")).turn_notes)).toContain("tn-empty");
    });
});
