// The curating model reads a message a connected app wrote as sent through an
// app, with the same words the conversation's own model is given; every other
// line of the transcript reads as before. The mark restricts nothing.
import { describe, expect, it } from "vitest";
import {
  buildMemoryCuratorTranscript,
  loadEligibleMemoryMessages,
  type MemoryCuratorStoredMessage,
} from "../memory.curator";

const row = (
  id: string,
  role: "user" | "assistant",
  content: unknown,
  extra: Partial<MemoryCuratorStoredMessage> = {},
): MemoryCuratorStoredMessage => ({
  id,
  role,
  content,
  author_user_id: "actor",
  memory_input_message_id: null,
  memory_eligible_at: null,
  memory_app_eligible_at: null,
  created_at: "2026-09-05T00:00:00.000Z",
  ...extra,
});
const answer = (id: string, inputId: string, second: number) =>
  row(id, "assistant", [{ type: "content", text: `Reply ${id}` }], {
    memory_input_message_id: inputId,
    memory_eligible_at: `2026-09-05T00:00:0${second}.000Z`,
    memory_app_eligible_at: `2026-09-05T00:00:0${second}.000Z`,
    created_at: `2026-09-05T00:00:0${second}.000Z`,
  });
const fromApp = { origin: "mcp" } as Partial<MemoryCuratorStoredMessage>;

describe("the memory curator's transcript of app-written messages", () => {
  it("says an app-written person message was sent through a connected app", () => {
    const transcript = buildMemoryCuratorTranscript(
      [row("u1", "user", "Typed by an app", fromApp), answer("a1", "u1", 1)],
      "actor",
      "user",
    );
    expect(transcript).toContain("User (sent through a connected app): Typed by an app");
    expect(buildMemoryCuratorTranscript(
      [row("u1", "user", "Typed by an app", fromApp), answer("a1", "u1", 1)],
      "actor",
      "project",
    )).toContain("Project member (sent through a connected app): Typed by an app");
  });

  it("keeps the ordinary line, byte for byte, when no message came from an app", () => {
    const rows = [row("u1", "user", "Typed here", { origin: null }), answer("a1", "u1", 1)];
    const unmarked = [row("u1", "user", "Typed here"), answer("a1", "u1", 1)];
    expect(buildMemoryCuratorTranscript(rows, "actor", "user")).toBe(
      "User: Typed here\n\nAssistant: Reply a1",
    );
    expect(buildMemoryCuratorTranscript(unmarked, "actor", "user")).toBe(
      "User: Typed here\n\nAssistant: Reply a1",
    );
  });

  it("labels only the app-written message of a mixed transcript, and keeps it eligible", () => {
    const transcript = buildMemoryCuratorTranscript(
      [
        row("u1", "user", "Typed here", { created_at: "2026-09-05T00:00:00.000Z" }),
        answer("a1", "u1", 1),
        row("u2", "user", "Typed by an app", { ...fromApp, created_at: "2026-09-05T00:00:02.000Z" }),
        answer("a2", "u2", 3),
      ],
      "actor",
      "user",
    );
    expect(transcript).toBe(
      [
        "User: Typed here",
        "Assistant: Reply a1",
        "User (sent through a connected app): Typed by an app",
        "Assistant: Reply a2",
      ].join("\n\n"),
    );
  });
});

describe("the messages the memory curator loads", () => {
  const selects: Array<{ table: string; columns: string }> = [];
  const db = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: (columns: string) => {
          selects.push({ table, columns });
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      for (const name of ["eq", "not", "in", "order", "limit"]) builder[name] = () => builder;
      return builder;
    },
  };

  it("reads the origin of the two tables that have it, and never of the Word table", async () => {
    selects.length = 0;
    for (const table of ["chat_messages", "tabular_review_chat_messages", "word_chat_messages"] as const) {
      await loadEligibleMemoryMessages(db as never, table, "c1", "actor");
    }
    const columnsOf = (table: string) => selects.filter((s) => s.table === table).map((s) => s.columns);
    for (const table of ["chat_messages", "tabular_review_chat_messages"]) {
      expect(columnsOf(table).length).toBeGreaterThan(0);
      for (const columns of columnsOf(table)) expect(columns.split(/,\s*/)).toContain("origin");
    }
    expect(columnsOf("word_chat_messages").length).toBeGreaterThan(0);
    for (const columns of columnsOf("word_chat_messages")) {
      expect(columns.split(/,\s*/)).not.toContain("origin");
    }
  });
});
