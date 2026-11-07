import { describe, expect, it } from "vitest";
import {
    PROMOTION_MIN_APPROVED_DEFENSES,
    PROMOTION_MIN_REVIEWED_WORKS,
    type PromotionInput,
    proposePromotions,
} from "./trainingPromotion";

const SINCE = "2026-01-01T00:00:00.000Z";
const day = (n: number) => `2026-02-${String(n).padStart(2, "0")}T10:00:00.000Z`;

function input(extra: Partial<PromotionInput> = {}): PromotionInput {
    return {
        stages: [{ practice: null, stage: "pasante", updated_at: SINCE }],
        defenses: [],
        reviews: [],
        approvals: [],
        ...extra,
    };
}

const approvedDefenses = (practice: string | null = null) => [
    { id: "d1", practice, outcome: "approved" as const, held_at: day(5) },
    { id: "d2", practice, outcome: "approved" as const, held_at: day(6) },
];

const reviewedWorks = (practice: string | null = null) => [
    { id: "w1", practice, at: day(2) },
    { id: "w2", practice, at: day(3) },
    { id: "w3", practice, at: day(4) },
];

describe("promotion thresholds", () => {
    it("are two approved defenses and three reviewed works", () => {
        expect(PROMOTION_MIN_APPROVED_DEFENSES).toBe(2);
        expect(PROMOTION_MIN_REVIEWED_WORKS).toBe(3);
    });

    it.each([
        { name: "1 approved defense, 3 works", defenses: approvedDefenses().slice(0, 1), reviews: reviewedWorks() },
        { name: "2 approved defenses, 2 works", defenses: approvedDefenses(), reviews: reviewedWorks().slice(0, 2) },
    ])("is not proposed with $name", ({ defenses, reviews }) => {
        const [proposal] = proposePromotions(input({ defenses, reviews }));
        expect(proposal.proposed).toBe(false);
        expect(proposal.blocked_by).toBeNull();
    });
});

describe("proposePromotions", () => {
    it("proposes a general pasante to junior with the evidence sorted by date", () => {
        const [proposal] = proposePromotions(
            input({
                defenses: [
                    { id: "d2", practice: null, outcome: "approved", held_at: day(9) },
                    { id: "d1", practice: null, outcome: "approved", held_at: day(5) },
                ],
                reviews: [
                    { id: "w3", practice: null, at: day(12) },
                    { id: "w1", practice: null, at: day(2) },
                    { id: "w2", practice: null, at: day(7) },
                ],
            }),
        );
        expect(proposal).toEqual({
            practice: null,
            from: "pasante",
            to: "junior",
            proposed: true,
            blocked_by: null,
            approved_defenses: [
                { id: "d1", at: day(5) },
                { id: "d2", at: day(9) },
            ],
            reviewed_works: [
                { id: "w1", at: day(2) },
                { id: "w2", at: day(7) },
                { id: "w3", at: day(12) },
            ],
            approved_versions: [],
            required: { approved_defenses: 2, reviewed_works: 3 },
        });
    });

    it("ignores evidence dated before the stage's updated_at", () => {
        const [proposal] = proposePromotions(
            input({
                defenses: [
                    { id: "old", practice: null, outcome: "approved", held_at: "2025-12-31T23:00:00.000Z" },
                    ...approvedDefenses().slice(0, 1),
                ],
                reviews: [{ id: "old", practice: null, at: "2025-12-31T23:00:00.000Z" }, ...reviewedWorks().slice(0, 2)],
            }),
        );
        expect(proposal.proposed).toBe(false);
        expect(proposal.approved_defenses.map((row) => row.id)).toEqual(["d1"]);
        expect(proposal.reviewed_works.map((row) => row.id)).toEqual(["w1", "w2"]);
    });

    it.each([
        {
            name: "a not_approved defense after the last approved one",
            defenses: [...approvedDefenses(), { id: "d3", practice: null, outcome: "not_approved" as const, held_at: day(8) }],
            blocked: "not_approved_after",
            proposed: false,
        },
        {
            name: "a not_approved defense before the approved ones",
            defenses: [{ id: "d0", practice: null, outcome: "not_approved" as const, held_at: day(1) }, ...approvedDefenses()],
            blocked: null,
            proposed: true,
        },
    ])("handles $name", ({ defenses, blocked, proposed }) => {
        const [proposal] = proposePromotions(input({ defenses, reviews: reviewedWorks() }));
        expect(proposal.blocked_by).toBe(blocked);
        expect(proposal.proposed).toBe(proposed);
    });

    it("counts a practice stage's own defenses and excludes the others", () => {
        const [proposal] = proposePromotions({
            stages: [{ practice: "laboral", stage: "pasante", updated_at: SINCE }],
            defenses: [...approvedDefenses("laboral"), ...approvedDefenses("civil").map((row) => ({ ...row, id: `c${row.id}` }))],
            reviews: reviewedWorks("laboral"),
            approvals: [],
        });
        expect(proposal.approved_defenses.map((row) => row.id)).toEqual(["d1", "d2"]);
        expect(proposal.proposed).toBe(true);
    });

    it("excludes other-practice and general evidence from a practice stage", () => {
        const [proposal] = proposePromotions({
            stages: [{ practice: "laboral", stage: "pasante", updated_at: SINCE }],
            defenses: [...approvedDefenses("civil"), ...approvedDefenses(null)],
            reviews: [
                { id: "c1", practice: "civil", at: day(2) },
                { id: "n1", practice: null, at: day(3) },
                { id: "l1", practice: "laboral", at: day(4) },
            ],
            approvals: [],
        });
        expect(proposal.approved_defenses).toHaveLength(0);
        expect(proposal.reviewed_works.map((row) => row.id)).toEqual(["l1"]);
        expect(proposal.proposed).toBe(false);
    });

    it("counts evidence of any practice for the general stage", () => {
        const [proposal] = proposePromotions({
            stages: [{ practice: null, stage: "pasante", updated_at: SINCE }],
            defenses: [...approvedDefenses("civil")],
            reviews: [
                { id: "c1", practice: "civil", at: day(2) },
                { id: "l1", practice: "laboral", at: day(3) },
                { id: "n1", practice: null, at: day(4) },
            ],
            approvals: [],
        });
        expect(proposal.approved_defenses).toHaveLength(2);
        expect(proposal.reviewed_works).toHaveLength(3);
        expect(proposal.proposed).toBe(true);
    });

    it("blocks a practice junior → abogado while a general stage remains", () => {
        const stages = [
            { practice: null, stage: "junior" as const, updated_at: SINCE },
            { practice: "laboral", stage: "junior" as const, updated_at: SINCE },
        ];
        const [, practice] = proposePromotions({
            stages,
            defenses: approvedDefenses("laboral"),
            reviews: reviewedWorks("laboral"),
            approvals: [],
        });
        expect(practice).toMatchObject({ practice: "laboral", to: "abogado", proposed: false, blocked_by: "general_stage_remains" });
    });

    it("proposes a practice junior → abogado when no general stage remains", () => {
        const [practice] = proposePromotions({
            stages: [{ practice: "laboral", stage: "junior", updated_at: SINCE }],
            defenses: approvedDefenses("laboral"),
            reviews: reviewedWorks("laboral"),
            approvals: [],
        });
        expect(practice).toMatchObject({ to: "abogado", proposed: true, blocked_by: null });
    });

    it("proposes a general junior → abogado with enough evidence", () => {
        const [proposal] = proposePromotions(
            input({
                stages: [{ practice: null, stage: "junior", updated_at: SINCE }],
                defenses: approvedDefenses(),
                reviews: reviewedWorks(),
            }),
        );
        expect(proposal).toMatchObject({ from: "junior", to: "abogado", proposed: true, blocked_by: null });
    });

    it("lists the general stage first, then practices alphabetically", () => {
        const proposals = proposePromotions({
            stages: [
                { practice: "laboral", stage: "pasante", updated_at: SINCE },
                { practice: "civil", stage: "pasante", updated_at: SINCE },
                { practice: null, stage: "pasante", updated_at: SINCE },
            ],
            defenses: [],
            reviews: [],
            approvals: [],
        });
        expect(proposals.map((row) => row.practice)).toEqual([null, "civil", "laboral"]);
    });

    it("lists approvals without requiring them, excluding those before updated_at", () => {
        const [proposal] = proposePromotions(
            input({
                defenses: approvedDefenses(),
                reviews: reviewedWorks(),
                approvals: [
                    { id: "old", practice: null, at: "2025-06-01T00:00:00.000Z" },
                    { id: "a1", practice: null, at: day(3) },
                ],
            }),
        );
        expect(proposal.proposed).toBe(true);
        expect(proposal.approved_versions).toEqual([{ id: "a1", at: day(3) }]);
        const [none] = proposePromotions(input({ defenses: approvedDefenses(), reviews: reviewedWorks() }));
        expect(none.proposed).toBe(true);
        expect(none.approved_versions).toEqual([]);
    });

    it("returns an empty list with no stages and no score-like keys in output", () => {
        expect(proposePromotions(input({ stages: [] }))).toEqual([]);
        const json = JSON.stringify(
            proposePromotions(input({ defenses: approvedDefenses(), reviews: reviewedWorks() })),
        );
        expect(json).not.toMatch(/score|average|promedio|rank|grade/i);
    });
});
