import { describe, expect, it } from "vitest";
import { blankPlaybookContent, listAllPlaybookRuns, listPlaybookRunHistory, listPlaybookRuns } from "../playbooks.operations";
import { database, type Row } from "./playbookTestDb";

// A stored run quotes the document it reviewed. Whoever lists runs reads those
// quotes only while they can open that document; a run over text that was
// pasted in has no document and keeps its text.
const OPEN_DOC = "d0000000-0000-4000-8000-000000000001";
const CLOSED_DOC = "d0000000-0000-4000-8000-000000000002";
const QUOTE = "the penalty is ten percent";
const reader = "owner";

function world() {
  const { db, tables } = database([
    {
      id: "book", user_id: reader, org_id: null, visibility: "private", shared_with: [], name: "Guide",
      description: "", content_json: blankPlaybookContent("Guide"), created_at: "2026-10-17", updated_at: "2026-10-17",
    },
  ]);
  tables.documents = [
    { id: OPEN_DOC, user_id: reader, project_id: null, org_id: null },
    { id: CLOSED_DOC, user_id: "someone", project_id: null, org_id: null },
  ];
  const run = (id: string, over: Row): Row => ({
    id, playbook_id: "book", user_id: reader, model: "claude-opus-5-5", document_name: `${id}.docx`,
    document_id: null, stored_document: null, review_mode: "strict", status: "completed",
    summary: `summary of ${id}`, findings_json: [{ id: "f1", status: "issue", quote: QUOTE, analysis: "x" }],
    content_json: blankPlaybookContent("Snapshot"), error: null,
    started_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z", completed_at: "2026-10-17T00:00:00.000Z", ...over,
  });
  tables.playbook_runs.push(
    run("open", { document_id: OPEN_DOC, stored_document: true }),
    run("closed", { document_id: CLOSED_DOC, stored_document: true }),
    run("deleted", { document_id: null, stored_document: true }),
    run("legacy-named", { document_id: null, stored_document: null }),
    run("pasted", { document_id: null, stored_document: false }),
    run("legacy-pasted", { document_id: null, document_name: null, stored_document: null }),
  );
  return { db, tables };
}

const WITHHELD = ["closed", "deleted", "legacy-named"];
const SHOWN = ["open", "pasted", "legacy-pasted"];

describe("playbook run lists for a reader who can no longer open a document", () => {
  it("withholds the summary, the findings and the name of every run the reader cannot open, in the History list of runs", async () => {
    const { db } = world();
    const runs = await listAllPlaybookRuns(reader, db, { workspace: "personal", email: "owner@example.com" });
    const byId = new Map(runs.map((entry) => [entry.id, entry]));
    for (const id of WITHHELD)
      expect(byId.get(id), id).toMatchObject({ summary: null, findings: [], documentName: null, documentId: null, detailsWithheld: true });
    for (const id of SHOWN) {
      expect(byId.get(id), id).toMatchObject({ summary: `summary of ${id}` });
      expect(byId.get(id)!.findings).toHaveLength(1);
      expect(byId.get(id)).not.toHaveProperty("detailsWithheld", true);
    }
    expect(JSON.stringify(WITHHELD.map((id) => byId.get(id)))).not.toContain(QUOTE);
  });

  it("does the same for one playbook's runs", async () => {
    const { db } = world();
    const runs = await listPlaybookRuns(reader, "book", db, "owner@example.com");
    expect(runs.filter((entry) => "detailsWithheld" in entry && entry.detailsWithheld).map((entry) => entry.id).sort()).toEqual([...WITHHELD].sort());
    expect(JSON.stringify(runs.filter((entry) => WITHHELD.includes(entry.id)))).not.toContain(QUOTE);
  });

  it("does not name the document of a run in the sidebar history", async () => {
    const { db } = world();
    const page = await listPlaybookRunHistory(reader, db, { email: "owner@example.com" });
    const names = new Map(page.map((entry) => [entry.id, entry.documentName]));
    for (const id of WITHHELD) expect(names.get(id), id).toBeNull();
    for (const id of ["open", "pasted"]) expect(names.get(id), id).toBe(`${id}.docx`);
    // The list says which ones are withheld, so a screen does not show them as an untitled review.
    expect(page.filter((entry) => "detailsWithheld" in entry).map((entry) => entry.id).sort()).toEqual([...WITHHELD].sort());
  });

  it("says why a run is withheld: lost access for a document that exists, and an unknown document for one not recorded or deleted", async () => {
    const { db } = world();
    const runs = await listAllPlaybookRuns(reader, db, { workspace: "personal", email: "owner@example.com" });
    const reason = (id: string) => (runs.find((entry) => entry.id === id) as { detailsWithheldReason?: string }).detailsWithheldReason;
    expect(reason("closed")).toBe("no_access");
    expect(reason("deleted")).toBe("source_unknown");
    expect(reason("legacy-named")).toBe("source_unknown");
    for (const id of SHOWN) expect(reason(id), id).toBeUndefined();
    const page = await listPlaybookRunHistory(reader, db, { email: "owner@example.com" });
    const sidebar = (id: string) => (page.find((entry) => entry.id === id) as { detailsWithheldReason?: string }).detailsWithheldReason;
    expect(sidebar("closed")).toBe("no_access");
    expect(sidebar("deleted")).toBe("source_unknown");
    expect(sidebar("open")).toBeUndefined();
  });

  it("fails, rather than lists the findings, when access cannot be checked", async () => {
    const { db } = world();
    const broken = {
      ...db,
      from: (table: string) => {
        if (table === "documents") throw new Error("access lookup down");
        return db.from(table);
      },
    } as unknown as typeof db;
    await expect(listAllPlaybookRuns(reader, broken, { workspace: "personal" })).rejects.toThrow();
    await expect(listPlaybookRuns(reader, "book", broken)).rejects.toThrow();
  });
});
