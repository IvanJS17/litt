import { describe, expect, it } from "vitest";
import { buildUserAccountExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// A playbook run quotes the document it reviewed. The holder's export carries
// those quotes only while the holder can open that document; the run itself
// (its playbook, status and dates) stays.
const holder = "associate";
const email = "associate@example.test";
const DOC_OPEN = "00000000-0000-4000-8000-0000000000a1";
const DOC_WALLED = "00000000-0000-4000-8000-0000000000a2";
const QUOTE = "QUOTE-FROM-THE-DOCUMENT";

const run = (id: string, over: Row = {}): Row => ({
    id, playbook_id: "book", user_id: holder, document_id: null, stored_document: null, document_name: null,
    summary: `SUMMARY-${id}`, findings_json: [{ quote: QUOTE }], status: "completed", started_at: "2026-02-01T00:00:00Z", ...over,
});

function world(runs: Row[]): Record<string, Row[]> {
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
        playbooks: [{ id: "book", user_id: holder, org_id: "org", visibility: "private", content_json: { name: "book" } }],
        playbook_runs: runs,
    };
}

const exported = async (runs: Row[]) => {
    const { db } = makeExportDb(world(runs));
    const out = await buildUserAccountExport(db, holder, email, "org");
    return new Map((out.playbook_runs as Row[]).map((row) => [row.id as string, row]));
};

describe("account export: playbook runs", () => {
    it("keeps the run but not what it quoted when the holder can no longer open its document", async () => {
        const byId = await exported([
            run("open", { document_id: DOC_OPEN, stored_document: true, document_name: "open.docx" }),
            run("walled", { document_id: DOC_WALLED, stored_document: true, document_name: "walled.docx" }),
            run("deleted", { stored_document: true, document_name: "gone.docx" }),
            run("unknown", { document_name: "old.docx" }),
            run("pasted", { stored_document: false, document_name: "pasted.docx" }),
        ]);
        expect([...byId.keys()].sort()).toEqual(["deleted", "open", "pasted", "unknown", "walled"]);
        expect(byId.get("open")).toMatchObject({ summary: "SUMMARY-open", document_name: "open.docx" });
        expect(byId.get("pasted")).toMatchObject({ summary: "SUMMARY-pasted", document_name: "pasted.docx" });
        for (const id of ["walled", "deleted", "unknown"])
            expect(byId.get(id), id).toMatchObject({ status: "completed", summary: null, findings_json: [], document_name: null, document_id: null });
        expect(JSON.stringify(["walled", "deleted", "unknown"].map((id) => byId.get(id)))).not.toContain(QUOTE);
    });
});
