import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// What an assistant answer was built from includes what the assistant searched
// and the files of a workflow it used. The export leaves an answer out, and
// every later answer of the chat and its title with it, once the holder can no
// longer open what it was built from; a holder who can open it all keeps it all.
const holder = "associate";
const email = "associate@example.test";
const DOC_OPEN = "00000000-0000-4000-8000-0000000000a1";
const DOC_WALLED = "00000000-0000-4000-8000-0000000000a2";
const DOC_LIB = "00000000-0000-4000-8000-0000000000a3"; // the holder's own library document
const DOC_GONE = "00000000-0000-4000-8000-0000000000a4"; // deleted
const ASSET = "00000000-0000-4000-8000-0000000000a5"; // a stored file of workflow WF
const WF = "00000000-0000-4000-8000-0000000000b1";
const WF_EMPTY = "00000000-0000-4000-8000-0000000000b2"; // no file left

function world(workflowOpen = true): Record<string, Row[]> {
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
        workflows: [
            { id: WF, user_id: "partner", org_id: "org", visibility: workflowOpen ? "organization" : "private", archived_at: null },
            { id: WF_EMPTY, user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
        ],
        documents: [
            { id: DOC_OPEN, user_id: "partner", project_id: "p-open", org_id: "org", archived_at: null },
            { id: DOC_WALLED, user_id: "partner", project_id: "p-walled", org_id: "org", archived_at: null },
            { id: DOC_LIB, user_id: holder, project_id: null, org_id: "org", archived_at: null },
            { id: ASSET, user_id: "partner", project_id: null, workflow_id: WF, org_id: "org", archived_at: null },
        ],
        chats: [{ id: "c", user_id: holder, org_id: "org", project_id: "p-open", title: "TITLE-C", created_at: "2026-02-01T00:00:00Z" }],
        chat_messages: [],
    };
}
const u = (id: string, over: Row = {}): Row => ({ id, role: "user", content: `TYPED-${id}`, files: null, ...over });
const a = (id: string, events: Row[], over: Row = {}): Row => ({ id, role: "assistant", content: [...events, { type: "content", text: `ANSWER-${id}` }], citations: null, ...over });
const search = (over: Row = {}): Row => ({ type: "doc_search", search_id: "s1", scope: "library", query: "fee", offset: 0, match_count: 1, ...over });

async function exportOf(tables: Record<string, Row[]>, messages: Row[]) {
    tables.chat_messages = messages.map((message, index) => ({ chat_id: "c", created_at: `2026-02-01T00:00:${String(10 + index)}Z`, ...message }));
    const { db } = makeExportDb(tables);
    const out = await buildUserAccountExport(db, holder, email, "org");
    const text = JSON.stringify(out.chats.messages);
    return {
        text,
        kept: (marker: string) => text.includes(marker),
        title: (out.chats.chats[0] as Row).title,
    };
}
// A first answer built from `events`, then a second with no events of its own.
const twoTurns = (events: Row[], over: Row = {}) => [u("u1"), a("a1", events, over), u("u2"), a("a2", [])];

describe("account export: answers built from assistant searches", () => {
    it("leaves out an answer built from a search whose document the holder can no longer open", async () => {
        for (const ids of [[DOC_GONE], [DOC_OPEN, DOC_WALLED]]) {
            const out = await exportOf(world(), twoTurns([search({ document_ids: ids })]));
            expect(out.kept("ANSWER-a1")).toBe(false);
            expect(out.kept("ANSWER-a2")).toBe(false);
            expect(out.kept("TYPED-u2")).toBe(true);
            expect(out.title).toBeNull();
        }
    });

    it("leaves out an answer built from a delegated search the holder can no longer open", async () => {
        const delegation = { type: "delegation", delegation_id: "d", title: "t", task: "t", status: "completed", brief: "BRIEF", model: "m", effort: "low", events: [search({ document_ids: [DOC_WALLED] })] };
        const out = await exportOf(world(), twoTurns([delegation]));
        expect(out.kept("ANSWER-a1")).toBe(false);
    });

    it("keeps everything for a holder who can open every document the search returned", async () => {
        const out = await exportOf(world(), twoTurns([search({ document_ids: [DOC_LIB, DOC_OPEN] })]));
        expect(out.kept("ANSWER-a1") && out.kept("ANSWER-a2")).toBe(true);
        expect(out.title).toBe("TITLE-C");
    });

    it("judges a search stored before documents were recorded by what it says", async () => {
        const verdict = async (event: Row) => (await exportOf(world(), twoTurns([event]))).kept("ANSWER-a1");
        // Stated limit: an old search of the project or of one document does not withhold the answer.
        expect(await verdict(search({ scope: "project" }))).toBe(true);
        expect(await verdict(search({ scope: "document" }))).toBe(true);
        // Nothing came back, or the search failed: nothing was copied.
        expect(await verdict(search({ match_count: 0 }))).toBe(true);
        expect(await verdict(search({ match_count: undefined, error_code: "internal_error" }))).toBe(true);
        // The person's library or templates cannot be traced to a document.
        expect(await verdict(search({ scope: "library" }))).toBe(false);
        expect(await verdict(search({ scope: "templates" }))).toBe(false);
        expect(await verdict(search({ scope: "" }))).toBe(false);
    });
});

describe("account export: answers built from a workflow's files", () => {
    const assetRead = { type: "doc_read", filename: "plantilla.docx", document_id: ASSET };
    const legacyRead = { type: "doc_read", filename: "plantilla.docx" };
    const applied = { type: "workflow_applied", workflow_id: WF, title: "WF" };
    const assetCitation = { type: "citation_data", kind: "document", doc_id: `workflow-asset-${WF}-1`, document: { document_id: `workflow-asset-${WF}-1`, title: "plantilla.docx" }, quote: "Q" };

    const shapes: [string, Row[], Row][] = [
        ["a read that recorded the file's document", [applied, assetRead], {}],
        ["a read stored without a document, in an answer that applied the workflow", [applied, legacyRead], {}],
        ["a citation of the file", [applied], { citations: [assetCitation] }],
    ];
    for (const [label, events, over] of shapes) {
        it(`keeps the answer, the later answers and the title of ${label} for a holder who may use the workflow`, async () => {
            const out = await exportOf(world(true), twoTurns(events, over));
            expect(out.kept("ANSWER-a1") && out.kept("ANSWER-a2")).toBe(true);
            expect(out.title).toBe("TITLE-C");
        });
        it(`leaves out ${label} for a holder who may not use the workflow`, async () => {
            const out = await exportOf(world(false), twoTurns(events, over));
            expect(out.kept("ANSWER-a1")).toBe(false);
            expect(out.kept("ANSWER-a2")).toBe(false);
            expect(out.kept("TYPED-u2")).toBe(true);
            expect(out.title).toBeNull();
        });
    }

    it("leaves out a file that cannot be traced to a workflow, or whose workflow has no file left", async () => {
        expect((await exportOf(world(), twoTurns([legacyRead]))).kept("ANSWER-a1")).toBe(false);
        const gone = { type: "citation_data", doc_id: `workflow-asset-${WF_EMPTY}-1`, document: { document_id: `workflow-asset-${WF_EMPTY}-1` } };
        expect((await exportOf(world(), twoTurns([], { citations: [gone] }))).kept("ANSWER-a1")).toBe(false);
    });

    it("keeps a chat whose attachment names no document, which the assistant never received", async () => {
        const out = await exportOf(world(), [u("u1", { files: [{ filename: "inline.pdf" }] }), a("a1", []), u("u2"), a("a2", [])]);
        expect(out.kept("inline.pdf") && out.kept("ANSWER-a1") && out.kept("ANSWER-a2")).toBe(true);
        expect(out.title).toBe("TITLE-C");
    });
});
