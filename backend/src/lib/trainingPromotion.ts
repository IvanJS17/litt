// LiTT training layers 2 and 3 (docs/training.md): promotion by evidence.
//
// LiTT proposes the next stage of a pupil (pasante → junior, junior →
// abogado) when there is evidence; the mentor always decides, with or
// without the proposal. The requirements are the approved oral defenses and
// the works the mentor marked reviewed. Shown beside them, not required: the
// pupil's drafts a mentor or a lawyer approved, the bulk-review audits the
// mentor evaluated and the full readings handed in. The confidence
// calibration (layer 3) can block a proposal, never a decision: when the
// pupil has marked enough turns and too many of their «Seguro» did not
// coincide with the AI's answer, `blocked_by` is `overconfident`.
//
// A pure function over rows already read, so the rule is tested with tables
// of cases. It never scores or compares people: it lists the evidence of one
// pupil against the two named thresholds.

import type { TrainingPromotionEvidence, TrainingPromotionProposal, TrainingStage } from "@mike/contracts";

/** Approved oral defenses needed since the stage last changed (layer 2, question 3). */
export const PROMOTION_MIN_APPROVED_DEFENSES = 2;
/** Works marked reviewed by the mentor needed since the stage last changed. */
export const PROMOTION_MIN_REVIEWED_WORKS = 3;

/**
 * Marked turns since the stage changed needed before the calibration can block
 * (layer-3 plan, open question 3). With fewer, the proposal is not blocked and
 * the calibration shows «pocos datos».
 */
export const PROMOTION_MIN_MARKED_TURNS = 10;
/** «Seguro» turns needed before their coincidences are weighed. */
export const PROMOTION_MIN_SURE_TURNS = 4;
/** Of the «Seguro» turns, at least this many in this many must have coincided (3 of 4). */
export const PROMOTION_SURE_COINCIDED = 3;
export const PROMOTION_SURE_OUT_OF = 4;
/** The thermometer level saved for «Seguro». */
export const SURE_LEVEL = 4;

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
    /** Layer 3; absent in a layer-2 caller: no calibration, no extra evidence. */
    turns?: readonly PromotionTurn[];
    audits?: readonly PromotionAudit[];
    /** Full readings handed in, dated by when. */
    readings?: readonly PromotionWork[];
    /** Layer 4: gym attempts submitted. Evidence only. */
    gym?: readonly PromotionGym[];
};

/** A turn the calibration counts; `practice` null: outside any practice area. */
export type PromotionTurn = {
    id: string;
    practice: string | null;
    at: string;
    /** The thermometer level 1 to 4 the person marked; null: no mark. */
    confidence: number | null;
    verdict: "coincide" | "parcial" | "no_coincide";
};
/** A gym attempt submitted: counts only (layer 4). */
export type PromotionGym = { id: string; practice: string | null; at: string; errors: number; found: number; hints: number };
/** An audit the mentor evaluated, dated by the evaluation. */
export type PromotionAudit = { id: string; practice: string | null; at: string; outcome: "adequate" | "needs_work" };

const time = (value: string) => Date.parse(value);

function evidence(rows: readonly { id: string; at: string }[]): TrainingPromotionEvidence[] {
    return [...rows].sort((a, b) => time(a.at) - time(b.at)).map(({ id, at }) => ({ id, at }));
}

function gymCounts(rows: readonly PromotionGym[]) {
    return {
        attempts: rows.length,
        errors: rows.reduce((sum, row) => sum + row.errors, 0),
        found: rows.reduce((sum, row) => sum + row.found, 0),
        hints: rows.reduce((sum, row) => sum + row.hints, 0),
    };
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
 * more evidence. `overconfident` weighs last: with at least
 * PROMOTION_MIN_MARKED_TURNS marked turns since the stage changed and at least
 * PROMOTION_MIN_SURE_TURNS of them marked «Seguro», fewer than 3 of every 4
 * «Seguro» coincided with the AI's answer. It blocks the proposal only; the
 * mentor can change the stage without it.
 */
export function proposePromotions(input: PromotionInput): TrainingPromotionProposal[] {
    const hasGeneral = input.stages.some((stage) => stage.practice === null);
    const ordered = [...input.stages].sort((a, b) =>
        a.practice === b.practice ? 0 : a.practice === null ? -1 : b.practice === null ? 1 : a.practice.localeCompare(b.practice),
    );
    const turns = input.turns ?? [];
    const audits = input.audits ?? [];
    const readings = input.readings ?? [];
    const gym = input.gym ?? [];
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
        const marked = turns.filter((row) => inScope(row) && time(row.at) >= since && row.confidence !== null);
        const sure = marked.filter((row) => row.confidence === SURE_LEVEL);
        const sureCoincided = sure.filter((row) => row.verdict === "coincide").length;
        const enough = marked.length >= PROMOTION_MIN_MARKED_TURNS;
        const overconfident =
            enough &&
            sure.length >= PROMOTION_MIN_SURE_TURNS &&
            sureCoincided * PROMOTION_SURE_OUT_OF < PROMOTION_SURE_COINCIDED * sure.length;
        const to = stage.stage === "pasante" ? "junior" : "abogado";
        const blockedBy =
            to === "abogado" && stage.practice !== null && hasGeneral
                ? "general_stage_remains"
                : notApprovedAfter
                  ? "not_approved_after"
                  : overconfident
                    ? "overconfident"
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
            evaluated_audits: [...audits.filter((row) => inScope(row) && time(row.at) >= since)]
                .sort((a, b) => time(a.at) - time(b.at))
                .map(({ id, at, outcome }) => ({ id, at, outcome })),
            readings: evidence(readings.filter((row) => inScope(row) && time(row.at) >= since)),
            gym: gymCounts(gym.filter((row) => inScope(row) && time(row.at) >= since)),
            calibration: {
                marked_turns: marked.length,
                min_marked_turns: PROMOTION_MIN_MARKED_TURNS,
                sure_marked: sure.length,
                sure_coincided: sureCoincided,
                min_sure_marked: PROMOTION_MIN_SURE_TURNS,
                enough,
            },
            required: {
                approved_defenses: PROMOTION_MIN_APPROVED_DEFENSES,
                reviewed_works: PROMOTION_MIN_REVIEWED_WORKS,
            },
        };
    });
}
