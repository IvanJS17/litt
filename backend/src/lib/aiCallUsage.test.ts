import { describe, expect, it, vi } from "vitest";
import { estimateCostUsd, meteredCompletion, recordAiCallUsage } from "./aiCallUsage";
import type { Db } from "./supabase";

const scope = {
    surface: "rule_suggestion_catalog",
    userId: "u1",
    orgId: "o1",
    matterId: "m1",
    projectId: "p1",
    provider: "claude",
    model: "claude-opus-5-5",
};

function fakeDb(error: unknown = null) {
    const insert = vi.fn().mockResolvedValue({ error });
    const from = vi.fn().mockReturnValue({ insert });
    return { db: { from } as unknown as Db, from, insert };
}

describe("ai_call_usage recording", () => {
    it("records tokens, engine, provider and model of a BYOK call; cost stays null", async () => {
        const { db, from, insert } = fakeDb();
        const complete = vi.fn(async (params: { onUsage?: (u: { inputTokens: number | null; outputTokens: number | null }) => void; user: string }) => {
            params.onUsage?.({ inputTokens: 1200, outputTokens: 80 });
            return "[]";
        });

        const answer = await meteredCompletion(db, scope, complete)({ user: "x" });

        expect(answer).toBe("[]");
        expect(from).toHaveBeenCalledWith("ai_call_usage");
        expect(insert).toHaveBeenCalledWith({
            org_id: "o1",
            user_id: "u1",
            matter_id: "m1",
            project_id: "p1",
            surface: "rule_suggestion_catalog",
            engine: "byok",
            provider: "claude",
            model: "claude-opus-5-5",
            input_tokens: 1200,
            output_tokens: 80,
            cost_usd: null,
        });
        // Nothing of the prompt or the answer goes into the row.
        expect(JSON.stringify(insert.mock.calls[0][0])).not.toContain("\"x\"");
    });

    it("records null tokens when the provider reports none (never a guess)", async () => {
        const { db, insert } = fakeDb();
        await meteredCompletion(db, scope, async () => "ok")({});
        expect(insert.mock.calls[0][0]).toMatchObject({ input_tokens: null, output_tokens: null });
    });

    it("records nothing when the call fails, and rethrows", async () => {
        const { db, insert } = fakeDb();
        await expect(
            meteredCompletion(db, scope, async () => {
                throw new Error("provider down");
            })({}),
        ).rejects.toThrow("provider down");
        expect(insert).not.toHaveBeenCalled();
    });

    it("does not change the answer when the row cannot be written", async () => {
        const { db } = fakeDb({ message: "42501" });
        await expect(meteredCompletion(db, scope, async () => "answer")({})).resolves.toBe("answer");
        const throwing = { from: () => { throw new Error("db gone"); } } as unknown as Db;
        await expect(recordAiCallUsage(throwing, scope, { inputTokens: 1, outputTokens: 1 })).resolves.toBeUndefined();
    });

    it("prices Jev from its input tokens and leaves BYOK null", () => {
        expect(estimateCostUsd("jev", { inputTokens: 1_000_000, outputTokens: 5 })).toBeCloseTo(0.042, 8);
        expect(estimateCostUsd("jev", { inputTokens: null, outputTokens: null })).toBeNull();
        expect(estimateCostUsd("byok", { inputTokens: 1_000_000, outputTokens: 5 })).toBeNull();
    });
});
