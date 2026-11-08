// A retake as stored, and the few reads every part of the module shares
// (docs/training.md, layer 3). The row is the person's learning data: the
// credential reference of its route is never serialized.

import type { TrainingRetake, TrainingRetakeStatus, TrainingVerdictValue } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { SUPERVISION_STALE_MS } from "../../lib/trainingSupervisionAi";
import { isUuid } from "../../lib/uuid";
import { LEARNING_NOT_FOUND } from "../training-supervision/trainingSupervision.service";

export const RETAKE_LIST_LIMIT = 100;

export type RetakeRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    topic_key: string;
    topic_label: string;
    status: TrainingRetakeStatus;
    question: string | null;
    answer: string | null;
    contrast: string | null;
    verdict: TrainingVerdictValue | null;
    model_provider: string | null;
    model: string | null;
    credential_ref: string | null;
    /** The turn notes the question was made from (and the answer is contrasted with). */
    source_note_ids: string[] | null;
    created_at: string;
    updated_at: string;
    answered_at: string | null;
};

export const retakeNotFound = () => failure("not_found", LEARNING_NOT_FOUND);

/**
 * A row `pending` for too long lost its call: with a question it waits for
 * the answer again (the answer was never saved), without one it failed.
 */
export function effectiveRetakeStatus(
    row: Pick<RetakeRow, "status" | "updated_at" | "question">,
    now: number = Date.now(),
): TrainingRetakeStatus {
    if (row.status !== "pending" || now - Date.parse(row.updated_at) < SUPERVISION_STALE_MS) return row.status;
    return row.question ? "open" : "failed";
}

/** Whether the row still holds the person's single pending-or-open slot. */
export const isLiveRetake = (row: Pick<RetakeRow, "status" | "updated_at" | "question">, now?: number) => {
    const status = effectiveRetakeStatus(row, now);
    return status === "pending" || status === "open";
};

/** The wire form: no credential reference, no route. The mentor is never sent a retake with a source note outside the matters they can open (see the view), so nothing here hides text. The source ids are not on the wire. */
export function serializeRetake(row: RetakeRow, now: number = Date.now()): TrainingRetake {
    return {
        id: row.id,
        org_id: row.org_id,
        topic_key: row.topic_key,
        topic_label: row.topic_label,
        status: effectiveRetakeStatus(row, now),
        question: row.question ?? null,
        answer: row.answer ?? null,
        contrast: row.contrast ?? null,
        verdict: row.verdict ?? null,
        created_at: row.created_at,
        answered_at: row.answered_at ?? null,
        text_hidden: false,
    };
}

/** A person's retakes in an organization, newest first. No access check. */
export async function readRetakes(db: Db, orgId: string, traineeId: string): Promise<ServiceResult<RetakeRow[]>> {
    const { data, error } = await db
        .from("training_retakes")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(RETAKE_LIST_LIMIT);
    if (error) return internalFailure(error);
    return ok((data ?? []) as unknown as RetakeRow[]);
}

/** The caller's own retake `retakeId`, or null: someone else's is the same as none. */
export async function loadOwnRetake(
    db: Db,
    args: { userId: string; retakeId: unknown },
): Promise<ServiceResult<RetakeRow | null>> {
    if (typeof args.retakeId !== "string" || !isUuid(args.retakeId)) return ok(null);
    const { data, error } = await db
        .from("training_retakes")
        .select("*")
        .eq("id", args.retakeId)
        .eq("trainee_user_id", args.userId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as unknown as RetakeRow | null) ?? null);
}
