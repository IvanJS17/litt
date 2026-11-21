// Project memory is read by every member of the project, so what the curator
// is handed for it must come only from turns whose sources are filed in the
// project and still readable by the person whose turn it was. These tests
// drive handleMemoryConsolidation itself: only the model call, the memory file
// store and the model choice are replaced; the access checks, the loaders and
// the transcript are real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { streamChatWithTools, resolveEffectiveChatModel, getUserModelSettings, ensureMemoryFile, getMemoryCurrentForFile } = vi.hoisted(() => ({
  streamChatWithTools: vi.fn(),
  resolveEffectiveChatModel: vi.fn(),
  getUserModelSettings: vi.fn(),
  ensureMemoryFile: vi.fn(),
  getMemoryCurrentForFile: vi.fn(),
}));
vi.mock("../../../lib/llm", async (orig) => ({ ...(await orig<typeof import("../../../lib/llm")>()), streamChatWithTools }));
vi.mock("../../../lib/modelSelection", async (orig) => ({ ...(await orig<typeof import("../../../lib/modelSelection")>()), resolveEffectiveChatModel }));
vi.mock("../../user/user.service", async (orig) => ({ ...(await orig<typeof import("../../user/user.service")>()), getUserModelSettings }));
vi.mock("../../../lib/memory/files", async (orig) => ({ ...(await orig<typeof import("../../../lib/memory/files")>()), ensureMemoryFile, getMemoryCurrentForFile }));
vi.mock("../memory.curatorEgress", async (orig) => ({
  ...(await orig<typeof import("../memory.curatorEgress")>()),
  curatorEgressAllowed: () => true,
  createGovernedCuratorStream: (sender: unknown) => sender,
}));

import { handleMemoryConsolidation } from "../memory.curator";
import { makeExportDb, type Row } from "../../../application/exports/__tests__/exportDb.fixture";

const ACTOR = "actor";
const DOC_IN = "00000000-0000-4000-8000-0000000000b1"; // filed in the project
const DOC_Q = "00000000-0000-4000-8000-0000000000b2"; // filed in another project
const DOC_LIB = "00000000-0000-4000-8000-0000000000b3"; // the actor's own library
const ASSET = "00000000-0000-4000-8000-0000000000b4"; // a stored file of workflow WF
const WF = "00000000-0000-4000-8000-0000000000c1";
const PAST = "2026-11-01T10:00:00.000Z";

function world(messages: Row[], { workflowOpen = true }: { workflowOpen?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    memory_consolidation_states: [{ id: "st", surface: "chat", conversation_id: "chat-1", actor_user_id: ACTOR, project_id: "P", generation: 2, processed_generation: 1, latest_turn_id: "a2", status: "scheduled" }],
    memory_conversation_activity: [{ id: "act", surface: "chat", conversation_id: "chat-1", generation: 5, quiet_until: PAST, deleted_at: null }],
    memory_conversation_turn_leases: [],
    memory_consolidation_results: [],
    organizations: [{ id: "org", kind: "team" }],
    org_members: [{ org_id: "org", user_id: ACTOR, role: "member" }, { org_id: "org", user_id: "partner", role: "owner" }],
    projects: [
      { id: "P", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
      { id: "Q", user_id: "partner", org_id: "org", visibility: "organization", archived_at: null },
    ],
    workflows: [{ id: WF, user_id: "partner", org_id: "org", visibility: workflowOpen ? "organization" : "private", archived_at: null }],
    documents: [
      { id: DOC_IN, user_id: "partner", project_id: "P", org_id: "org", archived_at: null },
      { id: DOC_Q, user_id: "partner", project_id: "Q", org_id: "org", archived_at: null },
      { id: DOC_LIB, user_id: ACTOR, project_id: null, org_id: "org", archived_at: null },
      { id: ASSET, user_id: "partner", project_id: null, workflow_id: WF, org_id: "org", archived_at: null },
    ],
    chats: [{ id: "chat-1", user_id: ACTOR, project_id: "P", org_id: "org", model: "claude-sonnet-5-5" }],
    chat_messages: messages.map((m) => ({ chat_id: "chat-1", author_user_id: ACTOR, files: null, citations: null, memory_app_eligible_at: null, ...m })),
  };
  const base = makeExportDb(tables).db;
  return {
    from: (t: string) => {
      const b = base.from(t);
      b.upsert = async () => ({ data: null, error: null });
      b.lt = () => b;
      b.gte = () => b;
      return b;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "set_memory_consolidation_status" || name === "refresh_memory_file_status") return { data: true, error: null };
      return base.rpc(name, args);
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "actor@example.test" } }, error: null }) } },
  };
}

const um = (id: string, at: number, text: string, over: Row = {}): Row => ({ id, role: "user", content: text, memory_input_message_id: null, memory_eligible_at: null, created_at: `2026-11-01T09:00:0${at}.000Z`, ...over });
const am = (id: string, at: number, input: string, events: Row[], over: Row = {}): Row => ({ id, role: "assistant", content: events, memory_input_message_id: input, memory_eligible_at: `2026-11-01T09:00:0${at}.000Z`, created_at: `2026-11-01T09:00:0${at}.000Z`, ...over });
const text = (t: string): Row => ({ type: "content", text: t });
const search = (over: Row = {}): Row => ({ type: "doc_search", search_id: "s", scope: "library", query: "fee", offset: 0, match_count: 2, ...over });

/** What the curator of project memory was handed, or "" when it never ran. */
async function projectTranscript(db: unknown): Promise<string> {
  streamChatWithTools.mockReset();
  streamChatWithTools.mockResolvedValue({ text: "", toolCalls: [] });
  await handleMemoryConsolidation(db as never, {
    id: "job-1",
    kind: "memory.consolidate",
    payload: { stateId: "st", generation: 2, conversationGeneration: 5, appEpoch: 1, sourceEpoch: 1, projectEpoch: 1, actorUserId: ACTOR, turnId: "a2", projectTurnId: "a2" },
  } as never);
  let seen = "";
  for (const [params] of streamChatWithTools.mock.calls as [{ systemPrompt: string; messages: { content: string }[] }][])
    if (params.systemPrompt.includes("shared project memory")) seen += params.messages.map((m) => m.content).join("\n");
  return seen;
}
/** A first turn nobody can object to, then a second turn built from `events`. */
const secondTurn = (events: Row[], over: Row = {}): Row[] => [
  um("u1", 1, "ASK-1"), am("a1", 2, "u1", [text("FACT-1")]),
  um("u2", 3, "ASK-2"), am("a2", 4, "u2", [...events, text("FACT-2")], over),
];

beforeEach(() => {
  resolveEffectiveChatModel.mockResolvedValue({ ok: true, model: "claude-sonnet-5-5" });
  getUserModelSettings.mockResolvedValue({ api_keys: { anthropic: "k" }, last_selected_chat_model: null, memory_curator_model: null });
  ensureMemoryFile.mockImplementation(async (_db: unknown, scope: string, owner: string, org?: string | null) => ({
    id: `file-${scope}`, scope, user_id: scope === "user" ? owner : null, project_id: scope === "project" ? owner : null, org_id: org ?? null,
    enabled: true, epoch: 1, revision: 1, learning_cutoff_at: null,
  }));
  getMemoryCurrentForFile.mockImplementation(async (_db: unknown, file: Row) => ({ current: { enabled: true, content: "", revision: 1 }, file }));
});

describe("what project memory is handed to learn from", () => {
  it("learns from a turn built only from the project's own documents", async () => {
    const seen = await projectTranscript(world(secondTurn([{ type: "doc_read", filename: "p.docx", document_id: DOC_IN }], { citations: [{ document_id: DOC_IN }] })));
    expect(seen).toContain("FACT-1");
    expect(seen).toContain("FACT-2");
  });

  it("learns nothing from a turn that read another project's document, nor from what follows it", async () => {
    // The turn being learned from is withheld, so the project curator is handed nothing of the chat.
    expect(await projectTranscript(world(secondTurn([{ type: "doc_read", filename: "q.docx", document_id: DOC_Q }])))).not.toContain("FACT-2");
  });

  describe("assistant searches", () => {
    it("learns nothing from a search that returned a library document, a template or another project's document", async () => {
      for (const ids of [[DOC_LIB], [DOC_IN, DOC_Q]]) {
        expect(await projectTranscript(world(secondTurn([search({ document_ids: ids })])))).not.toContain("FACT-2");
      }
    });

    it("learns from a search that returned only the project's documents", async () => {
      expect(await projectTranscript(world(secondTurn([search({ scope: "project", document_ids: [DOC_IN] })])))).toContain("FACT-2");
    });

    it("learns nothing from a delegated search over a library document", async () => {
      const delegation = { type: "delegation", delegation_id: "d", title: "t", task: "t", status: "completed", brief: "BRIEF", model: "m", effort: "low", events: [search({ document_ids: [DOC_LIB] })] };
      expect(await projectTranscript(world(secondTurn([delegation])))).not.toContain("FACT-2");
    });

    it("learns nothing from a search stored before its documents were recorded, whatever its scope", async () => {
      for (const scope of ["project", "library", "templates", "document"]) {
        const seen = await projectTranscript(world(secondTurn([search({ scope })])));
        expect(seen).not.toContain("FACT-2");
      }
    });

    it("learns from a search that returned nothing", async () => {
      expect(await projectTranscript(world(secondTurn([search({ match_count: 0 })])))).toContain("FACT-2");
    });
  });

  describe("workflow files", () => {
    const applied = { type: "workflow_applied", workflow_id: WF, title: "WF" };

    it("keeps learning from a turn that read a workflow's file, however the read was stored", async () => {
      for (const events of [
        [applied, { type: "doc_read", filename: "plantilla.docx", document_id: ASSET }],
        [applied, { type: "doc_read", filename: "plantilla.docx" }],
      ]) {
        const seen = await projectTranscript(world(secondTurn(events)));
        expect(seen).toContain("FACT-1");
        expect(seen).toContain("FACT-2");
      }
    });

    it("keeps learning from a turn that cited a workflow's file", async () => {
      const citation = { type: "citation_data", doc_id: `workflow-asset-${WF}-1`, document: { document_id: `workflow-asset-${WF}-1` } };
      expect(await projectTranscript(world(secondTurn([applied], { citations: [citation] })))).toContain("FACT-2");
    });

    it("learns nothing from a workflow the person may not use, or a file it cannot be traced to", async () => {
      const read = { type: "doc_read", filename: "plantilla.docx", document_id: ASSET };
      expect(await projectTranscript(world(secondTurn([applied, read]), { workflowOpen: false }))).not.toContain("FACT-2");
      expect(await projectTranscript(world(secondTurn([{ type: "doc_read", filename: "plantilla.docx" }])))).not.toContain("FACT-2");
    });
  });
});
