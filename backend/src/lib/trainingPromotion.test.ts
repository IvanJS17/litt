import { describe, expect, it } from "vitest";
import {
    PROMOTION_MIN_APPROVED_DEFENSES,
    PROMOTION_MIN_MARKED_TURNS,
    PROMOTION_MIN_REVIEWED_WORKS,
    PROMOTION_MIN_SURE_TURNS,
    type PromotionInput,
    type PromotionTurn,
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
            evaluated_audits: [],
            readings: [],
            calibration: {
                marked_turns: 0,
                min_marked_turns: 10,
                sure_marked: 0,
                sure_coincided: 0,
                min_sure_marked: 4,
                enough: false,
            },
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

    // The mentor learns what stands in the way before collecting more evidence;
    // the counts next to it say what is still missing.
    it.each([
        {
            name: "a general stage remains, with no evidence yet",
            stages: [
                { practice: null, stage: "junior" as const, updated_at: SINCE },
                { practice: "laboral", stage: "junior" as const, updated_at: SINCE },
            ],
            defenses: [],
            reviews: [],
            blocked: "general_stage_remains",
        },
        {
            name: "a not_approved defense after the only approved one, with 1 work",
            stages: [{ practice: "laboral", stage: "pasante" as const, updated_at: SINCE }],
            defenses: [
                { id: "d1", practice: "laboral", outcome: "approved" as const, held_at: day(5) },
                { id: "d2", practice: "laboral", outcome: "not_approved" as const, held_at: day(6) },
            ],
            reviews: reviewedWorks("laboral").slice(0, 1),
            blocked: "not_approved_after",
        },
    ])("reports blocked_by whatever the counts: $name", ({ stages, defenses, reviews, blocked }) => {
        const proposal = proposePromotions({ stages, defenses, reviews, approvals: [] }).find(
            (row) => row.practice === "laboral",
        );
        expect(proposal).toMatchObject({ proposed: false, blocked_by: blocked });
        expect(proposal!.approved_defenses.length < PROMOTION_MIN_APPROVED_DEFENSES).toBe(true);
        expect(proposal!.reviewed_works.length < PROMOTION_MIN_REVIEWED_WORKS).toBe(true);
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

const met = { defenses: approvedDefenses(), reviews: reviewedWorks() };

/** `sure` turns marked «Seguro`, `coincided` of them coinciding, plus `others` at level 2. */
function turns(sure: number, coincided: number, others: number, practice: string | null = null, at = day(10)): PromotionTurn[] {
    const make = (n: number, confidence: number, hit: (i: number) => boolean, tag: string): PromotionTurn[] =>
        Array.from({ length: n }, (_, i) => ({
            id: `${tag}${i}`,
            practice,
            at,
            confidence,
            verdict: hit(i) ? ("coincide" as const) : ("no_coincide" as const),
        }));
    return [...make(sure, 4, (i) => i < coincided, "s"), ...make(others, 2, () => true, "o")];
}

describe("calibration in the promotion (layer 3)", () => {
    it("names its constants", () => {
        expect(PROMOTION_MIN_MARKED_TURNS).toBe(10);
        expect(PROMOTION_MIN_SURE_TURNS).toBe(4);
    });

    it.each([
        { name: "no turns at all (a layer-2 caller)", t: undefined, blocked: null, enough: false },
        { name: "9 marked turns, none of the «Seguro» coincided (too few data)", t: turns(9, 0, 0), blocked: null, enough: false },
        { name: "10 marked, 3 «Seguro» none coinciding (too few «Seguro»)", t: turns(3, 0, 7), blocked: null, enough: true },
        { name: "10 marked, 4 «Seguro», 2 coinciding", t: turns(4, 2, 6), blocked: "overconfident", enough: true },
        { name: "10 marked, 4 «Seguro», 3 coinciding (3 of 4 passes)", t: turns(4, 3, 6), blocked: null, enough: true },
        { name: "10 marked, 8 «Seguro», 5 coinciding", t: turns(8, 5, 2), blocked: "overconfident", enough: true },
        { name: "10 marked, 8 «Seguro», 6 coinciding (exactly 3 of 4)", t: turns(8, 6, 2), blocked: null, enough: true },
    ])("with $name", ({ t, blocked, enough }) => {
        const [proposal] = proposePromotions(input({ ...met, turns: t }));
        expect(proposal.blocked_by).toBe(blocked);
        expect(proposal.proposed).toBe(blocked === null);
        expect(proposal.calibration.enough).toBe(enough);
    });

    it("does not count turns without a mark, dated before the stage, or of another practice", () => {
        const base = turns(4, 0, 6);
        const [proposal] = proposePromotions({
            stages: [{ practice: "laboral", stage: "pasante", updated_at: SINCE }],
            defenses: approvedDefenses("laboral"),
            reviews: reviewedWorks("laboral"),
            approvals: [],
            turns: [
                ...base.map((row) => ({ ...row, practice: "civil" })),
                ...turns(4, 0, 6, "laboral", "2025-12-01T00:00:00.000Z").map((row) => ({ ...row, id: `old${row.id}` })),
                ...turns(4, 0, 0, "laboral").map((row) => ({ ...row, id: `nm${row.id}`, confidence: null })),
            ],
        });
        expect(proposal.calibration).toMatchObject({ marked_turns: 0, sure_marked: 0, enough: false });
        expect(proposal.blocked_by).toBeNull();
    });

    it("lets the general stage count any practice and reports the counts of the person", () => {
        const [proposal] = proposePromotions(
            input({ ...met, turns: [...turns(3, 1, 3, "laboral"), ...turns(1, 0, 3, null)].map((row, i) => ({ ...row, id: `t${i}` })) }),
        );
        expect(proposal.calibration).toEqual({
            marked_turns: 10,
            min_marked_turns: 10,
            sure_marked: 4,
            sure_coincided: 1,
            min_sure_marked: 4,
            enough: true,
        });
        expect(proposal.blocked_by).toBe("overconfident");
    });

    it("keeps the older blocks first and reports overconfident even before the counts are met", () => {
        const notApproved = [...approvedDefenses(), { id: "d3", practice: null, outcome: "not_approved" as const, held_at: day(8) }];
        const [both] = proposePromotions(input({ defenses: notApproved, reviews: reviewedWorks(), turns: turns(4, 0, 6) }));
        expect(both.blocked_by).toBe("not_approved_after");
        const [early] = proposePromotions(input({ turns: turns(4, 0, 6) }));
        expect(early.blocked_by).toBe("overconfident");
        expect(early.proposed).toBe(false);
        const [lawyer] = proposePromotions({
            stages: [
                { practice: null, stage: "junior", updated_at: SINCE },
                { practice: "laboral", stage: "junior", updated_at: SINCE },
            ],
            defenses: [],
            reviews: [],
            approvals: [],
            turns: turns(4, 0, 6, "laboral"),
        });
        expect(lawyer.practice).toBeNull();
        const laboral = proposePromotions({
            stages: [
                { practice: null, stage: "junior", updated_at: SINCE },
                { practice: "laboral", stage: "junior", updated_at: SINCE },
            ],
            defenses: [],
            reviews: [],
            approvals: [],
            turns: turns(4, 0, 6, "laboral"),
        })[1];
        expect(laboral.blocked_by).toBe("general_stage_remains");
    });
});

describe("audits and readings as evidence (layer 3)", () => {
    it("lists them by date from the stage's change, in scope, without requiring them", () => {
        const [proposal] = proposePromotions(
            input({
                ...met,
                audits: [
                    { id: "a2", practice: null, at: day(9), outcome: "needs_work" },
                    { id: "a1", practice: "civil", at: day(3), outcome: "adequate" },
                    { id: "old", practice: null, at: "2025-12-01T00:00:00.000Z", outcome: "adequate" },
                ],
                readings: [
                    { id: "r2", practice: null, at: day(11) },
                    { id: "r1", practice: null, at: day(4) },
                    { id: "old", practice: null, at: "2025-12-01T00:00:00.000Z" },
                ],
            }),
        );
        expect(proposal.evaluated_audits).toEqual([
            { id: "a1", at: day(3), outcome: "adequate" },
            { id: "a2", at: day(9), outcome: "needs_work" },
        ]);
        expect(proposal.readings).toEqual([
            { id: "r1", at: day(4) },
            { id: "r2", at: day(11) },
        ]);
        expect(proposal.proposed).toBe(true);
    });

    it("counts only a practice stage's own", () => {
        const [proposal] = proposePromotions({
            stages: [{ practice: "laboral", stage: "pasante", updated_at: SINCE }],
            defenses: [],
            reviews: [],
            approvals: [],
            audits: [
                { id: "a1", practice: "laboral", at: day(3), outcome: "adequate" },
                { id: "a2", practice: "civil", at: day(3), outcome: "adequate" },
                { id: "a3", practice: null, at: day(3), outcome: "adequate" },
            ],
            readings: [
                { id: "r1", practice: "laboral", at: day(3) },
                { id: "r2", practice: "civil", at: day(3) },
            ],
        });
        expect(proposal.evaluated_audits.map((row) => row.id)).toEqual(["a1"]);
        expect(proposal.readings.map((row) => row.id)).toEqual(["r1"]);
    });
});
