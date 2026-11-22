import { describe, expect, it } from "vitest";
import { makeExportDb, type Row } from "../../../application/exports/__tests__/exportDb.fixture";
import {
  buildMemoryCuratorTranscript,
  projectMemoryEvidence,
  type MemoryCuratorStoredMessage,
} from "../memory.curator";

// Project memory is read by every member of the project, so it learns only
// from messages derived entirely from documents of that project that the
// person whose turn it was can still open. Anything else stays out of it.
const actor = { userId: "associate", email: "associate@example.test" };
const DOC_IN = "00000000-0000-4000-8000-0000000000b1";
const DOC_OUT = "00000000-0000-4000-8000-0000000000b2";

const message = (id: string, role: "user" | "assistant", at: number, over: Row = {}): MemoryCuratorStoredMessage =>
  ({
    id,
    role,
    content: [{ type: "content", text: `${role} ${id}` }],
    author_user_id: actor.userId,
    memory_input_message_id: role === "assistant" ? `u${id.slice(1)}` : null,
    memory_eligible_at: role === "assistant" ? "2026-10-01T00:00:00.000Z" : null,
    memory_app_eligible_at: null,
    created_at: `2026-10-01T00:00:0${at}.000Z`,
    ...over,
  }) as MemoryCuratorStoredMessage;

const loaded = [
  message("u1", "user", 1),
  message("a1", "assistant", 2),
  message("u2", "user", 3),
  message("a2", "assistant", 4),
];
const ids = (rows: MemoryCuratorStoredMessage[]) => rows.map((row) => row.id);

function tables(extra: Record<string, Row[]>): Record<string, Row[]> {
  return {
    organizations: [{ id: "org", kind: "team" }],
    org_members: [{ org_id: "org", user_id: actor.userId, role: "member" }],
    projects: [
      { id: "P", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
      { id: "Q", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
    ],
    documents: [
      { id: DOC_IN, user_id: "partner", project_id: "P", org_id: "org", archived_at: null },
      { id: DOC_OUT, user_id: "partner", project_id: "Q", org_id: "org", archived_at: null },
    ],
    ...extra,
  };
}

describe("project memory evidence: tabular review chats", () => {
  const state = { surface: "tabular", conversation_id: "tc-1" };
  const stored = (over: Record<string, string[] | null>): Row[] =>
    loaded.map((m) => ({ id: m.id, chat_id: "tc-1", source_document_ids: m.id in over ? over[m.id] : [DOC_IN] }));

  it("learns only from messages whose every source document belongs to the project", async () => {
    // The actor can read Q's document too, but it is not the project's.
    const { db } = makeExportDb(tables({ tabular_review_chat_messages: stored({ u2: [DOC_IN, DOC_OUT], a2: [DOC_IN, DOC_OUT] }) }));
    const kept = await projectMemoryEvidence(db, state, loaded, actor, "P");
    expect(ids(kept)).toEqual(["u1", "a1"]);
  });

  it("learns nothing from messages of unknown provenance", async () => {
    const { db } = makeExportDb(tables({ tabular_review_chat_messages: stored({ u2: null, a2: null }) }));
    expect(ids(await projectMemoryEvidence(db, state, loaded, actor, "P"))).toEqual(["u1", "a1"]);
  });

  it("learns nothing from sources the actor can no longer open", async () => {
    const data = tables({ tabular_review_chat_messages: stored({}) });
    data.project_org_access_overrides = [{ project_id: "P", org_id: "org", user_id: actor.userId, role: "deny" }];
    const { db } = makeExportDb(data);
    expect(await projectMemoryEvidence(db, state, loaded, actor, "P")).toEqual([]);
  });

  it("keeps every message derived from the project's own documents", async () => {
    const { db } = makeExportDb(tables({ tabular_review_chat_messages: stored({}) }));
    expect(ids(await projectMemoryEvidence(db, state, loaded, actor, "P"))).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("yields an empty project transcript when the terminal turn is withheld", async () => {
    const { db } = makeExportDb(tables({ tabular_review_chat_messages: stored({ u2: [DOC_OUT], a2: [DOC_OUT] }) }));
    const kept = await projectMemoryEvidence(db, state, loaded, actor, "P");
    const transcript = buildMemoryCuratorTranscript(kept, actor.userId, "project", { terminalTurnId: "a2" });
    expect(transcript).toBe("");
    expect(buildMemoryCuratorTranscript(kept, actor.userId, "project", { terminalTurnId: "a1" })).toContain("assistant a1");
  });

  it("learns nothing outside a project", async () => {
    const { db } = makeExportDb(tables({ tabular_review_chat_messages: stored({}) }));
    expect(await projectMemoryEvidence(db, state, loaded, actor, null)).toEqual([]);
  });
});

describe("project memory evidence: assistant chats", () => {
  const state = { surface: "chat", conversation_id: "chat-1" };
  const history = (over: Record<string, Row>): Row[] =>
    loaded.map((m) => ({ ...m, chat_id: "chat-1", files: null, citations: null, ...over[m.id] }));

  it("learns nothing from a turn that attached a document outside the project, nor from what follows", async () => {
    const { db } = makeExportDb(tables({
      chat_messages: history({ u2: { files: [{ filename: "q.docx", document_id: DOC_OUT }] } }),
    }));
    expect(ids(await projectMemoryEvidence(db, state, loaded, actor, "P"))).toEqual(["u1", "a1"]);
  });

  it("learns nothing from an answer that cites a document outside the project", async () => {
    const { db } = makeExportDb(tables({
      chat_messages: history({ a1: { citations: [{ document_id: DOC_OUT }] } }),
    }));
    expect(ids(await projectMemoryEvidence(db, state, loaded, actor, "P"))).toEqual(["u1"]);
  });

  it("learns nothing from a message that names a document without an identifier", async () => {
    const { db } = makeExportDb(tables({
      chat_messages: history({ a1: { content: [{ type: "doc_read", filename: "old.docx" }] } }),
    }));
    expect(ids(await projectMemoryEvidence(db, state, loaded, actor, "P"))).toEqual(["u1"]);
  });

  it("keeps every message of a chat over the project's own documents", async () => {
    const { db } = makeExportDb(tables({
      chat_messages: history({ u1: { files: [{ filename: "p.docx", document_id: DOC_IN }] }, a2: { citations: [{ document_id: DOC_IN }] } }),
    }));
    expect(ids(await projectMemoryEvidence(db, state, loaded, actor, "P"))).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("learns nothing from the Word add-in, which has no project", async () => {
    const { db } = makeExportDb(tables({}));
    expect(await projectMemoryEvidence(db, { surface: "word", conversation_id: "w" }, loaded, actor, null)).toEqual([]);
  });
});
