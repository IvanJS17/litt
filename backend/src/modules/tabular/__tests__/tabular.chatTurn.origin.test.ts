// A table review turn started with a connected app's origin hands the mark down
// to the stored message of the person; a turn started without one stores none.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb } from "../../../__tests__/helpers/memoryDb";

const { ensureReviewAccess, checkProjectAccess, filterAccessibleDocumentIds } = vi.hoisted(() => ({
    ensureReviewAccess: vi.fn(),
    checkProjectAccess: vi.fn(),
    filterAccessibleDocumentIds: vi.fn(),
}));
vi.mock("../../../lib/access", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/access")>()),
    ensureReviewAccess,
    checkProjectAccess,
    filterAccessibleDocumentIds,
}));
const { getUserModelSettings } = vi.hoisted(() => ({ getUserModelSettings: vi.fn() }));
vi.mock("../../user/user.settings", () => ({
    getUserModelSettings,
    persistLastSelectedChatModel: vi.fn(async () => null),
    persistLastSelectedReasoningLevel: vi.fn(async () => null),
}));
const { resolveEffectiveChatModel } = vi.hoisted(() => ({ resolveEffectiveChatModel: vi.fn() }));
vi.mock("../../../lib/modelSelection", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../lib/modelSelection")>()),
    resolveEffectiveChatModel,
}));
const loadReviewRows = vi.hoisted(() => vi.fn());
vi.mock("../tabular.rows", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../tabular.rows")>()),
    loadReviewRows,
}));
process.env.ANTHROPIC_API_KEY ??= "test-key";

import { resetStreamRunsForTests } from "../../../lib/streamRuns";
import { parseTabularChatRequest, startTabularChatTurn } from "../tabular.chatTurn";

const GRANT = "00000000-0000-4000-8000-0000000000a1";
const CHAT = "chat-1";
const REVIEW = { id: "rev-1", user_id: "u1", project_id: null, org_id: null, title: "Lease review", columns_config: [{ index: 0, name: "A" }] };
const parsedRequest = (() => {
    const result = parseTabularChatRequest({ messages: [{ role: "user", content: "hola" }], chat_id: CHAT });
    if (!result.ok) throw new Error("fixture request must parse");
    return result.value;
})();
const world = () =>
    memoryDb({
        tabular_reviews: [REVIEW],
        tabular_review_chats: [{ id: CHAT, review_id: "rev-1", user_id: "u1", title: "t", model: "claude-sonnet-5" }],
        tabular_review_chat_messages: [],
        tabular_cells: [],
    });
const startTurn = async (w: ReturnType<typeof world>, origin?: { grantId: string; label: string }) => {
    const turn = await startTabularChatTurn(w.db, { userId: "u1", userEmail: "u1@example.com", reviewId: "rev-1", parsed: parsedRequest, ...(origin ? { origin } : {}) });
    expect(turn.ok).toBe(true);
    return w.tables.tabular_review_chat_messages.find((m) => m.role === "user")!;
};

beforeEach(() => {
    vi.clearAllMocks();
    resetStreamRunsForTests();
    ensureReviewAccess.mockResolvedValue({ ok: true, isCreator: true, orgRole: null, projectRole: "owner" });
    checkProjectAccess.mockResolvedValue({ ok: false });
    filterAccessibleDocumentIds.mockImplementation(async (ids: string[]) => ids);
    loadReviewRows.mockResolvedValue([{ id: "row-1", label: "Contract.pdf" }]);
    getUserModelSettings.mockResolvedValue({ api_keys: {}, last_selected_chat_model: null, last_selected_reasoning_level: null, title_model: null });
    resolveEffectiveChatModel.mockResolvedValue({ ok: true, model: "claude-sonnet-5" });
});

describe("startTabularChatTurn and the mark of the person's message", () => {
    it("stores the origin, the connection and the app's name when a connected app started the turn", async () => {
        const stored = await startTurn(world(), { grantId: GRANT, label: "Notes app" });
        expect(stored).toMatchObject({ origin: "mcp", origin_grant_id: GRANT, origin_label: "Notes app" });
    });

    it("stores no mark when the turn was not started by a connected app", async () => {
        const stored = await startTurn(world());
        expect(stored).not.toHaveProperty("origin");
        expect(stored).not.toHaveProperty("origin_grant_id");
        expect(stored).not.toHaveProperty("origin_label");
    });
});
