// LiTT training layer 2 (docs/training.md): promotion by evidence.
//
// LiTT proposes the next stage of a pupil (pasante → junior, junior →
// abogado) when there is evidence; the mentor always decides. In layer 2 the
// evidence is the approved oral defenses and the work history: works the
// mentor marked reviewed and the pupil's drafts a mentor or a lawyer
// approved. Layers 3 and 4 add the gym and the confidence meter as further
// inputs of the same function, without changing what it returns.
//
// A pure function over rows already read, so the rule is tested with tables
// of cases. It never scores or compares people: it lists the evidence of one
// pupil against the two named thresholds.

import type { TrainingPromotionEvidence, TrainingPromotionProposal, TrainingStage } from "@mike/contracts";

/** Approved oral defenses needed since the stage last changed (layer 2, question 3). */
export const PROMOTION_MIN_APPROVED_DEFENSES = 2;
/** Works marked reviewed by the mentor needed since the stage last changed. */
export const PROMOTION_MIN_REVIEWED_WORKS = 3;

export type PromotionStage = { practice: string | null; stage: TrainingStage; updated_at: string };
/** A defense whose outcome was recorded; `practice` null counts for every practice area. */
export type PromotionDefense = {
    id: string;
    practice: string | null;
    outcome: "approved" | "not_approved";
    held_at: string;
};
/** A dated piece of work history in a practice area (null: none known). */
export type PromotionWork = { id: string; practice: string | null; at: string };

export type PromotionInput = {
    stages: readonly PromotionStage[];
    defenses: readonly PromotionDefense[];
    /** Works marked reviewed, dated by when they were marked. */
    reviews: readonly PromotionWork[];
    /** The pupil's approved drafts, dated by the approval. */
    approvals: readonly PromotionWork[];
};

const time = (value: string) => Date.parse(value);

function evidence(rows: readonly { id: string; at: string }[]): TrainingPromotionEvidence[] {
    return [...rows].sort((a, b) => time(a.at) - time(b.at)).map(({ id, at }) => ({ id, at }));
}

/**
 * One proposal per stage the pupil holds: the stage that covers every
 * practice area first, then each practice area in order. Evidence counts
 * from the moment the stage last changed; for a practice area only that
 * area's evidence counts, for the general stage any area's does.
 *
 * `blocked_by` is what would stop a proposal even with the counts met: a
 * defense not approved after the last approved one, or junior → abogado in
 * a practice area while a general stage remains (removing the practice
 * stage would leave the general one, not a lawyer). It is reported whether
 * or not the counts are met yet, so the mentor sees it before collecting
 * more evidence.
 */
export function proposePromotions(input: PromotionInput): TrainingPromotionProposal[] {
    const hasGeneral = input.stages.some((stage) => stage.practice === null);
    const ordered = [...input.stages].sort((a, b) =>
        a.practice === b.practice ? 0 : a.practice === null ? -1 : b.practice === null ? 1 : a.practice.localeCompare(b.practice),
    );
    return ordered.map((stage) => {
        const since = time(stage.updated_at);
        const inScope = (row: { practice: string | null }) =>
            stage.practice === null || row.practice === stage.practice;
        const defenses = input.defenses.filter((row) => inScope(row) && time(row.held_at) >= since);
        const approved = defenses.filter((row) => row.outcome === "approved");
        const lastApproved = Math.max(...approved.map((row) => time(row.held_at)));
        const notApprovedAfter =
            approved.length > 0 &&
            defenses.some((row) => row.outcome === "not_approved" && time(row.held_at) > lastApproved);
        const reviews = input.reviews.filter((row) => inScope(row) && time(row.at) >= since);
        const approvals = input.approvals.filter((row) => inScope(row) && time(row.at) >= since);
        const to = stage.stage === "pasante" ? "junior" : "abogado";
        const blockedBy =
            to === "abogado" && stage.practice !== null && hasGeneral
                ? "general_stage_remains"
                : notApprovedAfter
                  ? "not_approved_after"
                  : null;
        const met =
            approved.length >= PROMOTION_MIN_APPROVED_DEFENSES &&
            reviews.length >= PROMOTION_MIN_REVIEWED_WORKS;
        return {
            practice: stage.practice,
            from: stage.stage,
            to,
            proposed: met && blockedBy === null,
            blocked_by: blockedBy,
            approved_defenses: evidence(approved.map((row) => ({ id: row.id, at: row.held_at }))),
            reviewed_works: evidence(reviews),
            approved_versions: evidence(approvals),
            required: {
                approved_defenses: PROMOTION_MIN_APPROVED_DEFENSES,
                reviewed_works: PROMOTION_MIN_REVIEWED_WORKS,
            },
        };
    });
}
