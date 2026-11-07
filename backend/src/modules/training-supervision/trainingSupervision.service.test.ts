import { describe, expect, it, vi } from "vitest";
import type { Db } from "../../lib/supabase";
import { assertLearningAccess, getMySupervision, LEARNING_NOT_FOUND } from "./trainingSupervision.service";

// The rule itself is PostgreSQL's (training_can_read_learning); its role
// matrix runs against a real database in
// src/__tests__/sql/performance.litt-training-supervision.sql. Here: the
// gate asks it with the right arguments and turns every "no" into one 404.
const ORG = "00000000-0000-4000-8000-000000000010";
const PUPIL = "00000000-0000-4000-8000-000000000001";
const MENTOR = "00000000-0000-4000-8000-000000000002";

const fakeDb = (answer: { data?: unknown; error?: unknown }) => {
    const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
    return { db: { rpc } as unknown as Db, rpc };
};
const notFound = { ok: false, kind: "not_found", detail: LEARNING_NOT_FOUND };

describe("assertLearningAccess", () => {
    it("asks the database rule for this actor, organization and pupil", async () => {
        const { db, rpc } = fakeDb({ data: true });
        await expect(assertLearningAccess(db, { actorId: MENTOR, orgId: ORG, traineeId: PUPIL }))
            .resolves.toEqual({ ok: true, data: null });
        expect(rpc).toHaveBeenCalledWith("training_can_read_learning", {
            p_actor: MENTOR, p_org: ORG, p_trainee: PUPIL,
        });
    });

    it("answers the same 404 to a refusal and to a malformed id, without asking", async () => {
        const refused = fakeDb({ data: false });
        await expect(assertLearningAccess(refused.db, { actorId: MENTOR, orgId: ORG, traineeId: PUPIL }))
            .resolves.toEqual(notFound);
        for (const args of [
            { actorId: MENTOR, orgId: "nope", traineeId: PUPIL },
            { actorId: MENTOR, orgId: ORG, traineeId: undefined },
            { actorId: MENTOR, orgId: [ORG], traineeId: PUPIL },
        ]) {
            const { db, rpc } = fakeDb({ data: true });
            await expect(assertLearningAccess(db, args)).resolves.toEqual(notFound);
            expect(rpc).not.toHaveBeenCalled();
        }
    });

    it("fails closed on a database error", async () => {
        const { db } = fakeDb({ error: { code: "XX000", message: "boom" } });
        const result = await assertLearningAccess(db, { actorId: MENTOR, orgId: ORG, traineeId: PUPIL });
        expect(result).toMatchObject({ ok: false, kind: "error" });
    });
});

describe("getMySupervision", () => {
    it("is the caller's own, through the same gate", async () => {
        const { db, rpc } = fakeDb({ data: true });
        await expect(getMySupervision(db, { userId: PUPIL, orgId: ORG })).resolves.toEqual({
            ok: true,
            data: { org_id: ORG, work_reviews: [], defenses: [], urgency_passes: [] },
        });
        expect(rpc).toHaveBeenCalledWith("training_can_read_learning", {
            p_actor: PUPIL, p_org: ORG, p_trainee: PUPIL,
        });
    });

    it("404s outside an organization the caller belongs to", async () => {
        const { db } = fakeDb({ data: false });
        await expect(getMySupervision(db, { userId: PUPIL, orgId: ORG })).resolves.toEqual(notFound);
    });
});
