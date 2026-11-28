import { describe, expect, it } from "vitest";
import { buildUserAccountExport, buildUserChatsExport, buildUserTabularReviewsExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// When the export leaves something out because the holder cannot open what it
// was drawn from today, the download says so with counts only: never a title,
// an id or any text of what stayed behind. A download with nothing held back
// carries no such field.
const holder = "associate";
const email = "associate@example.test";
const DOC_OPEN = "00000000-0000-4000-8000-0000000000a1";
const DOC_WALLED = "00000000-0000-4000-8000-0000000000a2";

function world(walled: boolean): Record<string, Row[]> {
    const doc = walled ? DOC_WALLED : DOC_OPEN;
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
        project_org_access_overrides: [{ project_id: "p-walled", org_id: "org", user_id: holder, role: "deny" }],
        documents: [
            { id: DOC_OPEN, user_id: "partner", project_id: "p-open", org_id: "org", archived_at: null },
            { id: DOC_WALLED, user_id: "partner", project_id: "p-walled", org_id: "org", archived_at: null },
        ],
        chats: [
            { id: "chat-kept", user_id: holder, org_id: "org", project_id: "p-open", title: "TITLE-KEPT", created_at: "2026-02-01T00:00:00Z" },
            { id: "chat-held", user_id: holder, org_id: "org", project_id: "p-open", title: "TITLE-HELD-BACK", created_at: "2026-02-02T00:00:00Z" },
        ],
        chat_messages: [
            { id: "u1", chat_id: "chat-kept", role: "user", content: "TYPED-KEPT", files: null, created_at: "2026-02-01T00:00:01Z" },
            { id: "a1", chat_id: "chat-kept", role: "assistant", content: [{ type: "content", text: "ANSWER-KEPT" }], citations: [{ document_id: DOC_OPEN }], created_at: "2026-02-01T00:00:02Z" },
            { id: "u2", chat_id: "chat-held", role: "user", content: "TYPED-HELD", files: null, created_at: "2026-02-02T00:00:01Z" },
            { id: "a2", chat_id: "chat-held", role: "assistant", content: [{ type: "content", text: "ANSWER-HELD-BACK" }], citations: [{ document_id: doc }], created_at: "2026-02-02T00:00:02Z" },
        ],
        tabular_reviews: [{ id: "review", user_id: holder, org_id: "org", created_at: "2026-02-01T00:00:00Z" }],
        tabular_review_chats: [
            { id: "tchat-held", review_id: "review", user_id: holder, title: "REVIEW-TITLE-HELD-BACK", created_at: "2026-02-01T00:00:00Z" },
        ],
        tabular_review_chat_messages: [
            { id: "tm1", chat_id: "tchat-held", role: "assistant", content: "REVIEW-TEXT-HELD-BACK", source_document_ids: [doc], created_at: "2026-02-01T00:00:01Z" },
        ],
        playbooks: [{ id: "book", user_id: holder, org_id: "org", visibility: "private", content_json: { name: "book" } }],
        playbook_runs: [
            { id: "run-held", playbook_id: "book", user_id: holder, document_id: doc, stored_document: true, document_name: "RUN-DOC-HELD-BACK.docx", summary: "RUN-SUMMARY-HELD-BACK", findings_json: [{ quote: "RUN-QUOTE-HELD-BACK" }], status: "completed", started_at: "2026-02-01T00:00:00Z" },
        ],
    };
}

describe("account export: what was held back", () => {
    it("has no held_back field when everything the holder owns can still be opened", async () => {
        const { db } = makeExportDb(world(false));
        const out = await buildUserAccountExport(db, holder, email, "org");
        expect(out).not.toHaveProperty("held_back");
        expect(JSON.stringify(out)).toContain("ANSWER-HELD-BACK");
    });

    it("counts a conversation, a table-review chat and a playbook run held back, and names none of them", async () => {
        const { db } = makeExportDb(world(true));
        const out = await buildUserAccountExport(db, holder, email, "org");
        expect(out.held_back).toEqual({
            note: { "es-MX": expect.stringMatching(/no es una copia completa/i), "en-US": expect.stringMatching(/not a complete copy/i) },
            counts: { conversations: 1, table_review_chats: 1, playbook_runs: 1 },
        });
        const text = JSON.stringify(out);
        expect(text).not.toMatch(/HELD-BACK/);
        // Chats that were kept stay whole, and the field sits beside exported_at.
        expect(text).toContain("ANSWER-KEPT");
        expect(Object.keys(out).indexOf("held_back")).toBe(Object.keys(out).indexOf("exported_at") + 1);
    });
});

// Everything below leaves out exactly one kind of thing, so the count of that
// kind (and no other) is what the notice carries.
const other = "00000000-0000-4000-8000-0000000000b1";
const ID = (rows: Row[]) => rows.map((row) => row.id);

describe("account export: every kind of thing left out is counted", () => {
    it("counts a table-review cell the holder cannot read, and shows none of it", async () => {
        const { db } = makeExportDb({
            organizations: [{ id: "elsewhere", kind: "team" }],
            tabular_reviews: [{ id: "review", user_id: holder, org_id: null, project_id: null, archived_at: null }],
            tabular_review_rows: [{ id: "row", review_id: "review", document_id: other, sort_index: 0 }],
            tabular_cells: [{ id: "cell", review_id: "review", row_id: "row", content: "CELL-HELD-BACK" }],
            documents: [{ id: other, user_id: "colleague", project_id: null, org_id: "elsewhere", archived_at: null }],
        });
        const out = await buildUserAccountExport(db, holder, email, null);
        expect(out.held_back?.counts).toEqual({ table_review_cells: 1 });
        expect(JSON.stringify(out)).not.toContain("CELL-HELD-BACK");
    });

    it("counts a document row the holder cannot open", async () => {
        const { db } = makeExportDb({
            organizations: [{ id: "org", kind: "team" }],
            org_members: [{ org_id: "org", user_id: "partner", role: "owner" }],
            documents: [{ id: other, user_id: holder, project_id: null, org_id: "org", archived_at: null, filename: "DOC-HELD-BACK.docx" }],
        });
        const out = await buildUserAccountExport(db, holder, email, "org");
        expect(out.held_back?.counts).toEqual({ documents: 1 });
        expect(ID(out.documents)).toEqual([]);
        expect(JSON.stringify(out)).not.toContain("DOC-HELD-BACK");
    });

    it("counts a training record made from a matter the holder cannot open", async () => {
        const { db } = makeExportDb({
            organizations: [{ id: "org", kind: "team" }],
            org_members: [
                { org_id: "org", user_id: holder, role: "member" },
                { org_id: "org", user_id: "partner", role: "owner" },
            ],
            projects: [{ id: "p-walled", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null }],
            project_org_access_overrides: [{ project_id: "p-walled", org_id: "org", user_id: holder, role: "deny" }],
            training_urgency_passes: [{ id: "pass", org_id: "org", trainee_user_id: holder, project_id: "p-walled", reason_note: "PASS-HELD-BACK", created_at: "2026-01-01T00:00:00Z" }],
        });
        const out = await buildUserAccountExport(db, holder, email, "org");
        expect(out.held_back?.counts).toEqual({ training_records: 1 });
        expect(JSON.stringify(out)).not.toContain("PASS-HELD-BACK");
    });

    it("counts the runs of a playbook the holder cannot open", async () => {
        const { db } = makeExportDb({
            playbooks: [{ id: "book", user_id: "colleague", org_id: null, visibility: "private", content_json: { name: "BOOK-HELD-BACK" } }],
            playbook_runs: [{ id: "run", playbook_id: "book", user_id: holder, document_id: null, summary: "RUN-HELD-BACK", findings_json: [], status: "completed", started_at: "2026-01-01T00:00:00Z" }],
        });
        const out = await buildUserAccountExport(db, holder, email, null);
        expect(out.held_back?.counts).toEqual({ playbook_runs: 1 });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
    });

    it("carries no notice when only archived rows were left out", async () => {
        const archived_at = "2026-01-01T00:00:00Z";
        const { db } = makeExportDb({
            projects: [{ id: "p-old", user_id: holder, org_id: null, archived_at }],
            documents: [{ id: other, user_id: holder, project_id: null, org_id: null, archived_at }],
            chats: [{ id: "c-old", user_id: holder, org_id: null, project_id: null, archived_at, title: "OLD" }],
            tabular_reviews: [{ id: "r-old", user_id: holder, org_id: null, project_id: null, archived_at }],
            workflows: [{ id: "w-old", user_id: holder, org_id: null, project_id: null, archived_at }],
        });
        const out = await buildUserAccountExport(db, holder, email, null);
        expect(out).not.toHaveProperty("held_back");
        expect(out.projects).toEqual([]);
    });

    it("carries no notice when only the records of an organization the holder has left were left out", async () => {
        const { db } = makeExportDb({
            organizations: [{ id: "gone", kind: "team" }],
            playbooks: [{ id: "book", user_id: holder, org_id: "gone", visibility: "organization", content_json: { name: "FIRM-BOOK" } }],
            playbook_runs: [{ id: "run", playbook_id: "book", user_id: holder, document_id: null, summary: "FIRM-RUN", findings_json: [], status: "completed", started_at: "2026-01-01T00:00:00Z" }],
            playbook_imports: [{ id: "imp", user_id: holder, org_id: "gone", started_at: "2026-01-01T00:00:00Z" }],
        });
        const out = await buildUserAccountExport(db, holder, email, "gone");
        expect(out).not.toHaveProperty("held_back");
        expect(JSON.stringify(out)).not.toMatch(/FIRM-/);
    });

    it("writes the notice in both languages, with numbers only, and nothing else in the field", async () => {
        const { db } = makeExportDb(world(true));
        const out = await buildUserAccountExport(db, holder, email, "org");
        expect(Object.keys(out.held_back!).sort()).toEqual(["counts", "note"]);
        expect(Object.keys(out.held_back!.note).sort()).toEqual(["en-US", "es-MX"]);
        expect(out.held_back!.note["es-MX"]).toBe(
            "Esta descarga no es una copia completa: algunos elementos se retuvieron porque el material del que provienen no puede abrirse hoy. Abajo se cuenta, por tipo, lo que se retuvo.",
        );
        for (const count of Object.values(out.held_back!.counts)) expect(typeof count).toBe("number");
    });
});

describe("the chats-only and table-reviews-only downloads carry the same notice", () => {
    it("the chats-only download counts withheld messages and shows none of the withheld text", async () => {
        const { db } = makeExportDb(world(true));
        const out = await buildUserChatsExport(db, holder, email, "org");
        expect(out.held_back).toEqual({
            note: { "es-MX": expect.stringMatching(/no es una copia completa/i), "en-US": expect.stringMatching(/not a complete copy/i) },
            counts: { conversations: 1, table_review_chats: 1 },
        });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
        expect(Object.keys(out).indexOf("held_back")).toBe(Object.keys(out).indexOf("exported_at") + 1);
    });

    it("the chats-only download counts a withheld Word chat message", async () => {
        const { db } = makeExportDb({
            documents: [{ id: other, user_id: "colleague", project_id: null, org_id: null, archived_at: null }],
            word_documents: [{ id: "wd", user_id: holder, created_at: "2026-02-01T00:00:00Z" }],
            word_chats: [{ id: "wc", user_id: holder, word_document_id: "wd", title: "WORD-TITLE-HELD-BACK", created_at: "2026-02-01T00:00:00Z" }],
            word_chat_messages: [
                { id: "wm", chat_id: "wc", role: "assistant", content: [{ type: "content", text: "WORD-ANSWER-HELD-BACK" }], citations: [{ type: "citation_data", document_id: other, quote: "q" }], files: null, created_at: "2026-02-01T00:00:01Z" },
            ],
        });
        const out = await buildUserChatsExport(db, holder, email, null);
        expect(out.held_back?.counts).toEqual({ word_chats: 1 });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
    });

    it("the table-reviews-only download counts a withheld cell and review-chat message", async () => {
        const tables = world(true);
        tables.tabular_review_rows = [{ id: "row", review_id: "review", document_id: DOC_WALLED, sort_index: 0 }];
        tables.tabular_cells = [{ id: "cell", review_id: "review", row_id: "row", content: "CELL-HELD-BACK" }];
        const { db } = makeExportDb(tables);
        const out = await buildUserTabularReviewsExport(db, holder, email, "org");
        expect(out.held_back?.counts).toEqual({ table_review_cells: 1, table_review_chats: 1 });
        expect(JSON.stringify(out)).not.toMatch(/HELD-BACK/);
    });

    it("neither download has the field when nothing was held back", async () => {
        const { db } = makeExportDb(world(false));
        expect(await buildUserChatsExport(db, holder, email, "org")).not.toHaveProperty("held_back");
        expect(await buildUserTabularReviewsExport(db, holder, email, "org")).not.toHaveProperty("held_back");
    });
});
