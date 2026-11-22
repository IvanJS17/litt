import { describe, expect, it } from "vitest";
import { buildUserAccountExport, buildUserChatsExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// A chat message that carries what a document said (an attachment, a quote, a
// read) is a copy of that document. The export leaves it out once the holder
// can no longer open the document, as it leaves out the document itself; what
// the holder typed themselves, with no document behind it, stays.
const holder = "associate";
const email = "associate@example.test";
const DOC_OPEN = "00000000-0000-4000-8000-0000000000a1";
const DOC_WALLED = "00000000-0000-4000-8000-0000000000a2";

function tables(walled = true): Record<string, Row[]> {
    return {
        organizations: [{ id: "org", kind: "team" }],
        org_members: [
            { org_id: "org", user_id: holder, role: "member" },
            { org_id: "org", user_id: "partner", role: "owner" },
        ],
        projects: [
            { id: "p-open", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
            { id: "p-walled", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
        ],
        project_org_access_overrides: walled
            ? [{ project_id: "p-walled", org_id: "org", user_id: holder, role: "deny" }]
            : [],
        documents: [
            { id: DOC_OPEN, user_id: "partner", project_id: "p-open", org_id: "org", archived_at: null },
            { id: DOC_WALLED, user_id: "partner", project_id: "p-walled", org_id: "org", archived_at: null },
        ],
        chats: [
            { id: "chat-1", user_id: holder, org_id: "org", project_id: "p-open", title: "TITLE-1", created_at: "2026-02-01T00:00:00Z" },
            { id: "chat-2", user_id: holder, org_id: "org", project_id: "p-open", title: "TITLE-2", created_at: "2026-02-02T00:00:00Z" },
            { id: "chat-3", user_id: holder, org_id: "org", project_id: "p-open", title: "TITLE-3", created_at: "2026-02-03T00:00:00Z" },
        ],
        chat_messages: [
            { id: "u1", chat_id: "chat-1", role: "user", content: "TYPED-1", files: [{ filename: "open.docx", document_id: DOC_OPEN }, { filename: "WALLED-NAME.docx", document_id: DOC_WALLED }], created_at: "2026-02-01T00:00:01Z" },
            { id: "a1", chat_id: "chat-1", role: "assistant", content: [{ type: "content", text: "QUOTE-WALLED" }], citations: [{ type: "citation_data", document_id: DOC_WALLED, quote: "QUOTE-WALLED" }], created_at: "2026-02-01T00:00:02Z" },
            { id: "u2", chat_id: "chat-1", role: "user", content: "TYPED-2", files: null, created_at: "2026-02-01T00:00:03Z" },
            { id: "a2", chat_id: "chat-1", role: "assistant", content: [{ type: "content", text: "ANSWER-2" }], citations: null, created_at: "2026-02-01T00:00:04Z" },
            { id: "u3", chat_id: "chat-2", role: "user", content: "TYPED-3", files: [{ filename: "open.docx", document_id: DOC_OPEN }], created_at: "2026-02-02T00:00:01Z" },
            { id: "a3", chat_id: "chat-2", role: "assistant", content: [{ type: "doc_read", filename: "open.docx", document_id: DOC_OPEN }, { type: "content", text: "ANSWER-3" }], citations: [{ document_id: DOC_OPEN }], created_at: "2026-02-02T00:00:02Z" },
            { id: "u4", chat_id: "chat-3", role: "user", content: "TYPED-4", files: null, created_at: "2026-02-03T00:00:01Z" },
            { id: "a4", chat_id: "chat-3", role: "assistant", content: [{ type: "doc_read", filename: "legacy.docx" }, { type: "content", text: "ANSWER-4" }], created_at: "2026-02-03T00:00:02Z" },
        ],
    };
}

const byId = (rows: Row[]) => Object.fromEntries(rows.map((row) => [row.id as string, row]));

describe("account export: chats whose documents the holder can no longer open", () => {
    it("withholds document-derived content and keeps the holder's own typed text", async () => {
        const { db } = makeExportDb(tables());
        const out = await buildUserAccountExport(db, holder, email, "org");
        const messages = byId(out.chats.messages);

        expect(Object.keys(messages).sort()).toEqual(["a3", "u1", "u2", "u3", "u4"]);
        expect(messages.u1.content).toBe("TYPED-1");
        expect(messages.u1.files).toEqual([{ filename: "open.docx", document_id: DOC_OPEN }]);
        expect(messages.u2.content).toBe("TYPED-2");
        // A chat with something withheld has no title: it was written from the chat.
        const chats = byId(out.chats.chats);
        expect(chats["chat-1"].title).toBeNull();
        expect(chats["chat-3"].title).toBeNull();
        expect(chats["chat-2"].title).toBe("TITLE-2");
        const text = JSON.stringify(out.chats);
        expect(text).not.toMatch(/WALLED-NAME|QUOTE-WALLED|ANSWER-2|ANSWER-4/);
    });

    it("applies to the chats-only export too", async () => {
        const { db } = makeExportDb(tables());
        const out = await buildUserChatsExport(db, holder, email, "org");
        expect(JSON.stringify(out.assistant_chats)).not.toMatch(/WALLED-NAME|QUOTE-WALLED/);
    });

    it("keeps whole chats whose documents the holder can still open", async () => {
        const data = tables(false);
        const { db } = makeExportDb(data);
        const out = await buildUserAccountExport(db, holder, email, "org");
        const messages = byId(out.chats.messages);
        expect(Object.keys(messages).sort()).toEqual(["a1", "a2", "a3", "u1", "u2", "u3", "u4"]);
        expect(messages.u1.files).toHaveLength(2);
        expect(byId(out.chats.chats)["chat-1"].title).toBe("TITLE-1");
    });

    it("keeps whole chats for the owner of the firm", async () => {
        const data = tables();
        for (const chat of data.chats) chat.user_id = "partner";
        const { db } = makeExportDb(data);
        const out = await buildUserAccountExport(db, "partner", "partner@example.test", "org");
        expect(Object.keys(byId(out.chats.messages)).sort()).toEqual(["a1", "a2", "a3", "u1", "u2", "u3", "u4"].filter((id) => id !== "a4"));
    });
});
