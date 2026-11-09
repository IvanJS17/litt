import { beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ ensureReviewAccess: vi.fn() }));
vi.mock("../../lib/access", () => access);

import { loadPromotionLayer3 } from "./trainingSupervision.promotionEvidence";

// The mentor sees only what lives in a matter they can open; everything else
// is counted in `without_access` and never described (docs/training.md,
// «Promotion by evidence», layer 3).
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
    return {
        from(table: string) {
            let rows = [...(tables[table] ?? [])];
            const builder: any = {
                select: () => builder,
                eq: (col: string, value: unknown) => ((rows = rows.filter((r) => r[col] === value)), builder),
                not: (col: string, _op: string, _v: unknown) => ((rows = rows.filter((r) => r[col] != null)), builder),
                in: (col: string, values: unknown[]) => ((rows = rows.filter((r) => values.includes(r[col]))), builder),
                order: () => builder,
                limit: () => builder,
                then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
                    Promise.resolve({ data: rows, error: null }).then(resolve, reject),
            };
            return builder;
        },
    } as any;
}

const viewer = { orgId: "org", traineeId: "pupil", actorId: "mentor", actorEmail: "m@example.test" };
const lens = (openable: string[]) =>
    ({
        mayOpen: async (projectId: string | null) => !projectId || openable.includes(projectId),
        practice: async () => "laboral",
    }) as any;

beforeEach(() => access.ensureReviewAccess.mockReset());

describe("loadPromotionLayer3: audits", () => {
    const audit = (id: string, review: string) => ({
        id, org_id: "org", trainee_user_id: "pupil", tabular_review_id: review,
        mentor_outcome: "adequate", evaluated_at: "2026-01-02T00:00:00Z",
    });

    it("counts an audit of a review outside any matter in without_access when the mentor cannot open that review", async () => {
        access.ensureReviewAccess.mockResolvedValue({ ok: false });
        const db = fakeDb({
            training_turn_notes: [],
            training_readings: [],
            training_review_audits: [audit("a1", "r-own")],
            tabular_reviews: [{ id: "r-own", user_id: "pupil", project_id: null, org_id: "org" }],
        });
        const out = await loadPromotionLayer3(db, viewer, lens([]));
        expect(out).toMatchObject({ ok: true });
        if (!out.ok) return;
        expect(out.data.audits).toEqual([]);
        expect(out.data.without_access).toEqual({ turns: 0, audits: 1, readings: 0 });
        expect(access.ensureReviewAccess).toHaveBeenCalledWith(
            expect.objectContaining({ id: "r-own", project_id: null }), "mentor", "m@example.test", db,
        );
    });

    it("lists it, dated and with its outcome, when the mentor can open the review", async () => {
        access.ensureReviewAccess.mockResolvedValue({ ok: true });
        const db = fakeDb({
            training_turn_notes: [],
            training_readings: [],
            training_review_audits: [audit("a1", "r-own")],
            tabular_reviews: [{ id: "r-own", user_id: "pupil", project_id: null, org_id: "org" }],
        });
        const out = await loadPromotionLayer3(db, viewer, lens([]));
        if (!out.ok) throw new Error("expected ok");
        expect(out.data.audits).toEqual([expect.objectContaining({ id: "a1", outcome: "adequate" })]);
        expect(out.data.without_access.audits).toBe(0);
    });

    it("a review inside a matter follows the matter, not the review's own access", async () => {
        access.ensureReviewAccess.mockResolvedValue({ ok: true });
        const db = fakeDb({
            training_turn_notes: [],
            training_readings: [],
            training_review_audits: [audit("a1", "r-closed"), audit("a2", "r-open")],
            tabular_reviews: [
                { id: "r-closed", user_id: "pupil", project_id: "p-closed", org_id: "org" },
                { id: "r-open", user_id: "pupil", project_id: "p-open", org_id: "org" },
            ],
        });
        const out = await loadPromotionLayer3(db, viewer, lens(["p-open"]));
        if (!out.ok) throw new Error("expected ok");
        expect(out.data.audits.map((a) => a.id)).toEqual(["a2"]);
        expect(out.data.without_access.audits).toBe(1);
        expect(access.ensureReviewAccess).not.toHaveBeenCalled();
    });
});
