import { describe, expect, it } from "vitest";
import { buildUserAccountExport, buildUserChatsExport, buildUserTabularReviewsExport } from "../buildJsonExport";
import { makeExportDb, type Row } from "./exportDb.fixture";

// A message a connected app wrote keeps its origin and the app's name in the
// download; the id of the connection that wrote it is never part of it, and
// neither is the id of the connection a conversation was started by.
const holder = "associate";
const email = "associate@example.test";
const GRANT = "00000000-0000-4000-8000-0000000000c1";

const world = (): Record<string, Row[]> => ({
    chats: [{ id: "chat", user_id: holder, org_id: null, project_id: null, title: "T", origin: "mcp", origin_grant_id: GRANT, origin_label: "Notes app", created_at: "2026-02-01T00:00:00Z" }],
    chat_messages: [
        { id: "u1", chat_id: "chat", role: "user", content: "FROM-APP", files: null, origin: "mcp", origin_grant_id: GRANT, origin_label: "Notes app", created_at: "2026-02-01T00:00:01Z" },
        { id: "u2", chat_id: "chat", role: "user", content: "TYPED", files: null, origin: null, origin_grant_id: null, origin_label: null, created_at: "2026-02-01T00:00:02Z" },
    ],
    tabular_reviews: [{ id: "review", user_id: holder, org_id: null, created_at: "2026-02-01T00:00:00Z" }],
    tabular_review_chats: [{ id: "tchat", review_id: "review", user_id: holder, title: "T", created_at: "2026-02-01T00:00:00Z" }],
    tabular_review_chat_messages: [
        { id: "tm1", chat_id: "tchat", role: "user", content: "FROM-APP", source_document_ids: [], origin: "mcp", origin_grant_id: GRANT, origin_label: "Notes app", created_at: "2026-02-01T00:00:01Z" },
    ],
});

type Section = { chats: Row[]; messages: Row[] };
const assertMarked = (out: unknown, assistant: Section, tabular: Section) => {
    const fromApp = assistant.messages.find((m) => m.id === "u1")!;
    expect(fromApp).toMatchObject({ origin: "mcp", origin_label: "Notes app" });
    expect(fromApp).not.toHaveProperty("origin_grant_id");
    const review = tabular.messages.find((m) => m.id === "tm1")!;
    expect(review).toMatchObject({ origin: "mcp", origin_label: "Notes app" });
    expect(review).not.toHaveProperty("origin_grant_id");
    expect(assistant.chats[0]).toMatchObject({ origin: "mcp", origin_label: "Notes app" });
    expect(assistant.chats[0]).not.toHaveProperty("origin_grant_id");
    expect(JSON.stringify(out)).not.toContain(GRANT);
};

describe("exports of messages a connected app wrote", () => {
    it("keeps origin and the app's name and carries no connection id, in the account download", async () => {
        const out = (await buildUserAccountExport(makeExportDb(world()).db, holder, email, null)) as unknown as { chats: Section; tabular_review_chats: Section };
        assertMarked(out, out.chats, out.tabular_review_chats);
    });

    it("does the same in the chats download", async () => {
        const out = await buildUserChatsExport(makeExportDb(world()).db, holder, email, null);
        assertMarked(out, out.assistant_chats, out.tabular_review_chats);
    });

    it("does the same in the table reviews download", async () => {
        const out = await buildUserTabularReviewsExport(makeExportDb(world()).db, holder, email, null);
        const review = out.tabular_review_chats.messages.find((m) => m.id === "tm1")!;
        expect(review).toMatchObject({ origin: "mcp", origin_label: "Notes app" });
        expect(JSON.stringify(out)).not.toContain(GRANT);
    });
});
