// A review chat asks again, at each read of the table, whether the person may
// still open the review, judging the review's row as it is at that moment: a
// review moved to a place the person cannot reach, or deleted, after the turn
// started serves no cells; an unchanged review serves the same ones.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "../../../__tests__/helpers/memoryDb";

const mocks = vi.hoisted(() => ({
    ensureReviewAccess: vi.fn(),
    filterAccessibleDocumentIds: vi.fn(),
    loadReviewRows: vi.fn(),
}));
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    ensureReviewAccess: mocks.ensureReviewAccess,
    checkProjectAccess: vi.fn(async () => ({ ok: false })),
    filterAccessibleDocumentIds: mocks.filterAccessibleDocumentIds,
}));
vi.mock("../../user/user.settings", () => ({
    getUserModelSettings: vi.fn(async () => ({
        api_keys: {},
        last_selected_chat_model: null,
        last_selected_reasoning_level: null,
        title_model: null,
    })),
    persistLastSelectedChatModel: vi.fn(async () => null),
    persistLastSelectedReasoningLevel: vi.fn(async () => null),
}));
vi.mock("../../../lib/modelSelection", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/modelSelection")>()),
    resolveEffectiveChatModel: vi.fn(async () => ({ ok: true, model: "claude-sonnet-5" })),
}));
vi.mock("../tabular.rows", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.rows")>()),
    loadReviewRows: mocks.loadReviewRows,
}));
process.env.ANTHROPIC_API_KEY ??= "test-key";

import { readableTableRowIds } from "../../chat/engine/tools/tableCells";
import { prepareTabularChat } from "../tabular.chats";
import type { Db } from "../../../lib/supabase";

const ME = "user-1";
const EMAIL = "me@example.com";

// The person may open a review only while it sits in project "P".
function world() {
    const tables = {
        tabular_reviews: [
            { id: "rev-1", user_id: "someone-else", project_id: "P" as string | null, org_id: null, title: "Lease review", columns_config: [{ index: 0, name: "A" }] },
        ],
        tabular_cells: [{ id: "c1", review_id: "rev-1", column_index: 0, row_id: "row-1", content: '{"summary":"yes"}' }],
    };
    const { db, failNext } = memoryDb(tables);
    return { tables, db, failNext };
}

async function startTurn(db: Db) {
    const result = await prepareTabularChat(db, {
        reviewId: "rev-1",
        userId: ME,
        userEmail: EMAIL,
        messages: [{ role: "user", content: "hi" }],
        lastUserContent: "hi",
        chatId: undefined,
        requestedModel: undefined,
        requestedReasoning: undefined,
    });
    if (!result.ok) throw new Error("the turn did not start");
    return result.data.tabularStore;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureReviewAccess.mockImplementation(async (review: { project_id: string | null }) =>
        review.project_id === "P"
            ? { ok: true, isCreator: false, orgRole: null, projectRole: "editor" }
            : { ok: false },
    );
    mocks.filterAccessibleDocumentIds.mockImplementation(async (ids: string[]) => ids);
    mocks.loadReviewRows.mockResolvedValue([{ id: "row-1", label: "Contract.pdf", source_document_ids: ["d1"] }]);
});

describe("the table read in a review chat judges the review as it is now", () => {
    it("serves the same rows while the review is unchanged", async () => {
        const { db } = world();
        const store = await startTurn(db);
        const ids = await readableTableRowIds(store, db, ME, EMAIL);
        expect([...(ids ?? [])]).toEqual(["row-1"]);
    });

    it("serves nothing once the review was moved where the person cannot reach it", async () => {
        const { db, tables } = world();
        const store = await startTurn(db);
        tables.tabular_reviews[0].project_id = "Q";
        expect(await readableTableRowIds(store, db, ME, EMAIL)).toBeNull();
    });

    it("serves nothing once the review was moved into a personal space", async () => {
        const { db, tables } = world();
        const store = await startTurn(db);
        tables.tabular_reviews[0].project_id = null;
        tables.tabular_reviews[0].user_id = "someone-else";
        expect(await readableTableRowIds(store, db, ME, EMAIL)).toBeNull();
    });

    it("serves nothing once the review was deleted", async () => {
        const { db, tables } = world();
        const store = await startTurn(db);
        tables.tabular_reviews.splice(0, 1);
        expect(await readableTableRowIds(store, db, ME, EMAIL)).toBeNull();
    });

    it("serves nothing when the review cannot be read", async () => {
        const { db, failNext } = world();
        const store = await startTurn(db);
        failNext("tabular_reviews", "select", { message: "database down" });
        expect(await readableTableRowIds(store, db, ME, EMAIL)).toBeNull();
    });
});
