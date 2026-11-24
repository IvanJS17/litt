// A playbook review run from a chat returns quotes of the document it read, so
// the turn records that document (and its version) like any other read.
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock("../../../playbooks/playbooks.service", async (load) => ({
  ...(await load<typeof import("../../../playbooks/playbooks.service")>()),
  reviewWithPlaybook: mocks.review,
}));
vi.mock("../tools/documentOps", async (load) => ({
  ...(await load<typeof import("../tools/documentOps")>()),
  readDocumentContent: async () => "DOCUMENT-TEXT",
}));

import { runToolCalls } from "../tools/toolDispatcher";
import type { DocIndex, DocStore } from "../types";
import type { Db } from "../../../../lib/supabase";
import { buildUserAccountExport } from "../../../../application/exports/buildJsonExport";
import { makeExportDb, type Row } from "../../../../application/exports/__tests__/exportDb.fixture";
import { filterChatMemoryEvidence } from "../../../../lib/chatReadAccess";

const H = "holder";
const EMAIL = "holder@example.test";
const DOC = "00000000-0000-4000-8000-0000000000d3";
const VERSION = "00000000-0000-4000-8000-0000000000f1";

const finding = { ruleName: "r", status: "ok", location: "l", analysis: "a", quote: "PLAYBOOK-QUOTE", suggestedText: null };
const review = () =>
  mocks.review.mockReset().mockResolvedValue({ id: "run", summary: "S", findings: [finding], editedVersionId: null, editedVersionNumber: null });

async function run(store: DocStore, index: DocIndex) {
  const call = { id: "r", function: { name: "run_playbook", arguments: JSON.stringify({ doc_id: "doc-0", playbook_id: "pb" }) } };
  return runToolCalls([call], store, H, {} as Db, () => {}, undefined, undefined, index, undefined, undefined, "P", undefined, {
    userEmail: EMAIL,
    model: "m",
    credentialRef: "user:u1:claude:v1",
  });
}
const stored = () => ({
  store: new Map([["doc-0", { filename: "p.pdf", file_type: "pdf", storage_path: "s" }]]) as DocStore,
  index: { "doc-0": { document_id: DOC, filename: "p.pdf", version_id: VERSION, version_number: 3 } } as DocIndex,
});
// The stored events of the turn, as streaming records them.
const eventsOf = (b: Awaited<ReturnType<typeof run>>): Row[] =>
  b.docsRead.map((r) => ({ type: "doc_read", filename: r.filename, document_id: r.document_id, version_id: r.version_id, version_number: r.version_number }));

function tables(readable: boolean, events: Row[], inProject: boolean): Record<string, Row[]> {
  return {
    organizations: [{ id: "org", kind: "team" }],
    org_members: [{ org_id: "org", user_id: H, role: "member" }, { org_id: "org", user_id: "partner", role: "owner" }],
    projects: [
      { id: "P", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
      { id: "W", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
    ],
    project_org_access_overrides: readable ? [] : [{ project_id: "W", org_id: "org", user_id: H, role: "deny" }],
    workflows: [],
    documents: [{ id: DOC, user_id: "partner", project_id: readable && inProject ? "P" : "W", org_id: "org", archived_at: null }],
    chats: [{ id: "c1", user_id: H, org_id: "org", project_id: "P", title: "TITLE", created_at: "2026-01-01T00:00:00Z" }],
    chat_messages: [
      { id: "u1", chat_id: "c1", role: "user", content: "TYPED", files: null, citations: null, created_at: "2026-01-01T00:00:01Z" },
      { id: "a1", chat_id: "c1", role: "assistant", content: [...events, { type: "content", text: "ANSWER-a1" }], files: null, citations: null, created_at: "2026-01-01T00:00:02Z" },
    ],
  };
}

describe("playbook review run from a chat", () => {
  it("records the stored document and the version it reviewed", async () => {
    review();
    const { store, index } = stored();
    const batch = await run(store, index);
    expect((batch.toolResults[0] as { content: string }).content).toContain("PLAYBOOK-QUOTE");
    expect(batch.docsRead).toEqual([{ filename: "p.pdf", document_id: DOC, version_id: VERSION, version_number: 3 }]);
  });

  it("names the version reviewed even when the review saves a new one", async () => {
    mocks.review.mockReset().mockResolvedValue({
      id: "run", summary: "S", findings: [{ ...finding, edit: { kind: "edit" } }],
      editedVersionId: "00000000-0000-4000-8000-0000000000f2", editedVersionNumber: 4, editedDownloadUrl: "", editedTrainingHeld: false,
    });
    const { store, index } = stored();
    const batch = await run(store, index);
    expect(batch.docsRead).toEqual([{ filename: "p.pdf", document_id: DOC, version_id: VERSION, version_number: 3 }]);
  });

  it("export: the answer is left out once the document is unreadable, kept for a person with access", async () => {
    review();
    const { store, index } = stored();
    const events = eventsOf(await run(store, index));
    const kept = JSON.stringify(await buildUserAccountExport(makeExportDb(tables(true, events, true)).db, H, EMAIL, "org"));
    const lost = JSON.stringify(await buildUserAccountExport(makeExportDb(tables(false, events, true)).db, H, EMAIL, "org"));
    expect(kept).toContain("ANSWER-a1");
    expect(lost).not.toContain("ANSWER-a1");
  });

  it("project memory learns from a review of a project document, not of one filed elsewhere", async () => {
    review();
    const { store, index } = stored();
    const events = eventsOf(await run(store, index));
    const learn = async (inProject: boolean) => {
      const t = tables(true, events, inProject);
      const messages = (t.chat_messages as Row[]).map((m) => ({ ...m, id: m.id as string }));
      const out = await filterChatMemoryEvidence(makeExportDb(t).db, messages, "c1", { userId: H, userEmail: EMAIL }, "P");
      return out.map((m) => m.id).join(",");
    };
    expect(await learn(true)).toContain("a1");
    expect(await learn(false)).not.toContain("a1");
  });

  it("records nothing when the review failed before reading anything", async () => {
    mocks.review.mockReset().mockRejectedValue(new Error("model down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, index } = stored();
    const batch = await run(store, index);
    expect(batch.docsRead).toEqual([]);
  });

  it("records nothing for Word's open file, which has no stored row", async () => {
    review();
    const store: DocStore = new Map([["doc-0", { filename: "open.docx", file_type: "docx", inline_text: "LIVE" } as never]]);
    const batch = await run(store, {});
    expect((batch.toolResults[0] as { content: string }).content).toContain("PLAYBOOK-QUOTE");
    expect(batch.docsRead).toEqual([]);
  });
});
