/**
 * LiTT: the memory curator's provider egress fails closed. A real provider
 * host is refused before the job reads any credential (user model settings
 * decrypt the stored keys) and before any provider request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(async () => ({ fullText: "" })),
  getUserModelSettings: vi.fn(),
  resolveEffectiveChatModel: vi.fn(),
}));

vi.mock("../../../lib/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/llm")>()),
  streamChatWithTools: mocks.stream,
}));
vi.mock("../../user/user.service", () => ({
  getUserModelSettings: mocks.getUserModelSettings,
}));
vi.mock("../../../lib/modelSelection", () => ({
  hasApiKeyForModel: () => true,
  resolveEffectiveChatModel: mocks.resolveEffectiveChatModel,
}));
vi.mock("../../../lib/wordWorkspace", () => ({
  wordChatHasWorkspaceAttachments: async () => false,
}));
vi.mock("../../../lib/memory/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/memory/files")>()),
  ensureMemoryFile: async () => memoryFile,
  getMemoryCurrentForFile: async () => ({
    file: memoryFile,
    current: { enabled: true, content: "", revision: 0 },
  }),
}));

const memoryFile = {
  id: "file-1",
  scope: "user",
  owner_id: "u1",
  enabled: true,
  epoch: 1,
  revision: 0,
  learning_cutoff_at: null,
};

const AT = "2026-09-05T00:00:01.000000Z";
const messages = [
  {
    id: "input-1",
    role: "user",
    content: "Prefiero contratos en español.",
    author_user_id: "u1",
    memory_input_message_id: null,
    memory_eligible_at: null,
    memory_app_eligible_at: null,
    created_at: "2026-09-05T00:00:00.000000Z",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: "Anotado.",
    author_user_id: "u1",
    memory_input_message_id: "input-1",
    memory_eligible_at: AT,
    memory_app_eligible_at: AT,
    created_at: AT,
  },
];

function quietDb() {
  const past = new Date(Date.now() - 60 * 60_000).toISOString();
  const rows: Record<string, unknown> = {
    memory_consolidation_states: {
      id: "state-1",
      surface: "word",
      conversation_id: "conv-1",
      actor_user_id: "u1",
      project_id: null,
      generation: 2,
      processed_generation: 1,
      latest_turn_id: "assistant-1",
      status: "scheduled",
    },
    memory_conversation_activity: {
      generation: 5,
      quiet_until: past,
      deleted_at: null,
    },
    word_chats: { id: "conv-1", user_id: "u1", model: "gpt-5.4" },
  };
  function from(table: string) {
    const q: Record<string, unknown> = {};
    for (const m of [
      "select",
      "eq",
      "gt",
      "lt",
      "not",
      "in",
      "order",
      "limit",
      "update",
      "insert",
      "upsert",
      "contains",
      "is",
    ])
      q[m] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: rows[table] ?? null, error: null }));
    q.single = q.maybeSingle;
    q.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({
        data: table === "word_chat_messages" ? messages : [],
        error: null,
      }).then(resolve);
    return q;
  }
  return {
    from: vi.fn(from),
    rpc: vi.fn(async () => ({ data: true, error: null })),
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: "u1@example.test" } },
          error: null,
        }),
      },
    },
  };
}

beforeEach(() => {
  mocks.stream.mockClear();
  mocks.getUserModelSettings.mockReset().mockResolvedValue({
    api_keys: { openai: "sk-should-never-be-read" },
    last_selected_chat_model: "gpt-5.4",
    memory_curator_model: null,
    personalisation: undefined,
  });
  mocks.resolveEffectiveChatModel
    .mockReset()
    .mockResolvedValue({ ok: true, model: "gpt-5.4" });
});

describe("memory curator egress gate", () => {
  it("stops a real-provider job before reading credentials or calling the provider", async () => {
    const { handleMemoryConsolidation } = await import("../memory.curator.js");

    const result = await handleMemoryConsolidation(quietDb() as never, {
      id: "job-1",
      kind: "memory.consolidate",
      attempts: 1,
      payload: {
        stateId: "state-1",
        generation: 2,
        conversationGeneration: 5,
        appEpoch: 1,
        sourceEpoch: 1,
        actorUserId: "u1",
        turnId: "assistant-1",
      },
    } as never);

    expect(result).toMatchObject({ skipped: "egress_blocked" });
    expect(mocks.getUserModelSettings).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("refuses a real host in the default scope stream before any request", async () => {
    const { runMemoryCuratorScope } = await import("../memory.curator.js");

    await expect(
      runMemoryCuratorScope({
        db: {} as never,
        file: { id: "file-1", scope: "user", owner_id: "u1" } as never,
        current: { content: "", revision: 0 },
        transcript: "<conversation-transcript>x</conversation-transcript>",
        model: "gpt-5.4",
        apiKeys: { openai: "sk-should-never-be-sent" },
        actorUserId: "u1",
        actorEmail: null,
        stateId: "state-1",
        generation: 2,
        expectedEpoch: 1,
        sourceEpoch: 1,
        conversationGeneration: 5,
        surface: "word",
        conversationId: "conv-1",
        turnId: null,
        jobId: "job-1",
      }),
    ).rejects.toThrow();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("allows only the policy's allowlisted host", async () => {
    const { curatorEgressAllowed, createGovernedCuratorStream } = await import(
      "../memory.curatorEgress.js"
    );
    for (const model of ["gpt-5.4", "claude-sonnet-5-5", "gemini-3.8-flash", null, ""]) {
      expect(curatorEgressAllowed(model)).toBe(false);
    }
    const sender = vi.fn();
    await expect(
      createGovernedCuratorStream(sender)({ model: "gpt-5.4" } as never),
    ).rejects.toMatchObject({
      name: "MemoryCuratorEgressBlockedError",
      kind: "real_provider_egress_blocked",
    });
    expect(sender).not.toHaveBeenCalled();
  });
});
