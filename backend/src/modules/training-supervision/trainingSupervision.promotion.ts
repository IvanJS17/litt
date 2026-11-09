// Promotion by evidence (docs/training.md, layer 2 §6.4).
//
// GET  …/pupils/:userId/promotion   the proposals, computed on every read from
//                                   the pupil's stages and evidence
//                                   (lib/trainingPromotion.ts); nothing stored
// POST …/pupils/:userId/promotion   the mentor accepts one: `{ practice, to }`
//
// LiTT proposes, the mentor always decides. Accepting recomputes the
// proposal and requires it to be still in force, then changes the stage only
// through the training facade (setStage for junior, removeStage for
// abogado), so "only the current mentor" and its audit apply as for any
// stage change. The audit adds training.promotion_accepted with no stage.
//
// The evidence is what the current mentor can see: works in matters they
// cannot open, and drafts, turns, audits and readings in them, do not count;
// layer 3 only counts them (`without_access`). The calibration and the
// audits and readings (trainingSupervision.promotionEvidence.ts) may block a
// proposal (`overconfident`) or be shown beside it; they never decide: the
// mentor can change the stage without LiTT's proposal.

import type {
    TrainingAcceptPromotionBody,
    TrainingPromotion,
    TrainingPromotionTarget,
} from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isTrainingStage } from "../../lib/training";
import {
    proposePromotions,
    type PromotionDefense,
    type PromotionInput,
    type PromotionStage,
    type PromotionWork,
} from "../../lib/trainingPromotion";
import { workPlace } from "../../lib/trainingWork";
import { readPractice, removeStage, setStage } from "../training/training.service";
import { assertCurrentMentor } from "./trainingSupervision.access";
import { projectLens, type Viewer } from "./trainingSupervision.lens";
import { loadPromotionLayer3, type PromotionLayer3 } from "./trainingSupervision.promotionEvidence";
import { selectIn, surfaceOf } from "./trainingSupervision.signals";

export const PROMOTION_NOT_PROPOSED_CODE = "training_promotion_not_proposed";
const NOT_PROPOSED = "LiTT no longer proposes this promotion. Reload to see the current evidence.";
const APPROVALS_LIMIT = 1000;

type Actor = { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown };

/** Reads everything proposePromotions needs. */
type Loaded = { input: PromotionInput; without_access: PromotionLayer3["without_access"] };

async function loadPromotionInput(db: Db, viewer: Viewer): Promise<ServiceResult<Loaded>> {
    const { orgId, traineeId } = viewer;
    const lens = projectLens(db, viewer);
    try {
        const stagesRead = await db
            .from("training_stages")
            .select("practice, stage, updated_at")
            .eq("org_id", orgId)
            .eq("trainee_user_id", traineeId);
        if (stagesRead.error) return internalFailure(stagesRead.error);
        const stages: PromotionStage[] = (
            (stagesRead.data ?? []) as { practice: string | null; stage: string; updated_at: string }[]
        ).flatMap((row) => (isTrainingStage(row.stage) ? [{ ...row, stage: row.stage }] : []));

        const defensesRead = await db
            .from("training_defenses")
            .select("id, practice, outcome, held_at")
            .eq("org_id", orgId)
            .eq("trainee_user_id", traineeId)
            .not("outcome", "is", null);
        if (defensesRead.error) return internalFailure(defensesRead.error);
        const defenses = (defensesRead.data ?? []) as unknown as PromotionDefense[];

        const reviewsRead = await db
            .from("training_work_reviews")
            .select("id, chat_id, word_chat_id, tabular_chat_id, status, reviewed_at")
            .eq("org_id", orgId)
            .eq("trainee_user_id", traineeId)
            .eq("status", "ready")
            .not("reviewed_at", "is", null);
        if (reviewsRead.error) return internalFailure(reviewsRead.error);
        const reviews: PromotionWork[] = [];
        for (const row of (reviewsRead.data ?? []) as {
            id: string;
            chat_id: string | null;
            word_chat_id: string | null;
            tabular_chat_id: string | null;
            reviewed_at: string;
        }[]) {
            const at = surfaceOf(row);
            if (!at) continue;
            const place = await workPlace(db, at.surface, at.chatId);
            if (!place.ok) return internalFailure(place.error);
            if (!place.place || !(await lens.mayOpen(place.place.projectId))) continue;
            reviews.push({ id: row.id, practice: await lens.practice(place.place.projectId), at: row.reviewed_at });
        }

        // The pupil's sealed drafts approved in this organization.
        const approvalsRead = await db
            .from("training_version_approvals")
            .select("id, document_version_id, created_at")
            .eq("org_id", orgId)
            .order("created_at", { ascending: false })
            .limit(APPROVALS_LIMIT);
        if (approvalsRead.error) return internalFailure(approvalsRead.error);
        const approvalRows = (approvalsRead.data ?? []) as { id: string; document_version_id: string; created_at: string }[];
        const versions = await selectIn<{ id: string; document_id: string; training_author_user_id: string | null; deleted_at: string | null }>(
            db,
            "document_versions",
            "id, document_id, training_author_user_id, deleted_at",
            "id",
            [...new Set(approvalRows.map((row) => row.document_version_id))],
        );
        if (!versions.ok) return versions;
        const own = new Map(
            versions.data
                .filter((version) => version.training_author_user_id === traineeId && !version.deleted_at)
                .map((version) => [version.id, version.document_id]),
        );
        const documents = await selectIn<{ id: string; project_id: string | null }>(
            db,
            "documents",
            "id, project_id",
            "id",
            [...new Set(own.values())],
        );
        if (!documents.ok) return documents;
        const projectOf = new Map(documents.data.map((doc) => [doc.id, doc.project_id ?? null]));
        const approvals: PromotionWork[] = [];
        for (const row of approvalRows) {
            const documentId = own.get(row.document_version_id);
            if (!documentId) continue;
            const projectId = projectOf.get(documentId) ?? null;
            if (!(await lens.mayOpen(projectId))) continue;
            approvals.push({ id: row.document_version_id, practice: await lens.practice(projectId), at: row.created_at });
        }
        const layer3 = await loadPromotionLayer3(db, viewer, lens);
        if (!layer3.ok) return layer3;
        const { without_access, ...evidence } = layer3.data;
        return ok({ input: { stages, defenses, reviews, approvals, ...evidence }, without_access });
    } catch (error) {
        return internalFailure(error);
    }
}

/** GET …/pupils/:userId/promotion */
export async function getPromotion(db: Db, actor: Actor): Promise<ServiceResult<TrainingPromotion>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const input = await loadPromotionInput(db, { ...gate.data, actorId: actor.actorId, actorEmail: actor.actorEmail });
    if (!input.ok) return input;
    return ok({ proposals: proposePromotions(input.data.input), without_access: input.data.without_access });
}

/** POST …/pupils/:userId/promotion: `{ practice, to }`, a proposal still in force. */
export async function acceptPromotion(
    db: Db,
    actor: Actor & { body: unknown },
): Promise<ServiceResult<TrainingPromotion>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const body = (actor.body ?? {}) as Partial<TrainingAcceptPromotionBody>;
    const practice = readPractice(body.practice);
    if (!practice.ok) return practice;
    const to = body.to as TrainingPromotionTarget;
    if (to !== "junior" && to !== "abogado") return failure("validation", "Choose junior or abogado.");

    const viewer = { orgId, traineeId, actorId: actor.actorId, actorEmail: actor.actorEmail };
    const input = await loadPromotionInput(db, viewer);
    if (!input.ok) return input;
    const proposal = proposePromotions(input.data.input).find(
        (entry) => entry.practice === practice.data && entry.to === to && entry.proposed,
    );
    if (!proposal) return failure("conflict", NOT_PROPOSED, PROMOTION_NOT_PROPOSED_CODE);

    const stageActor = { actorId: actor.actorId, actorEmail: actor.actorEmail, orgId, userId: traineeId, practice: practice.data };
    const changed =
        to === "junior" ? await setStage(db, { ...stageActor, stage: "junior" }) : await removeStage(db, stageActor);
    if (!changed.ok) return changed;
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId,
        action: "training.promotion_accepted",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: traineeId },
    });
    const after = await loadPromotionInput(db, viewer);
    if (!after.ok) return after;
    return ok({ proposals: proposePromotions(after.data.input), without_access: after.data.without_access });
}
