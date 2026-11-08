// A periodic full reading as stored, and the few reads every part of the
// module shares (docs/training.md, layer 3). The row is the person's
// learning data: it never carries the document's title, and the credential
// reference of its route is never serialized.

import type {
    TrainingReading,
    TrainingReadingComparison,
    TrainingReadingMachineFinding,
    TrainingReadingStatus,
} from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { SUPERVISION_STALE_MS } from "../../lib/trainingSupervisionAi";
import { isUuid } from "../../lib/uuid";
import { LEARNING_NOT_FOUND } from "../training-supervision/trainingSupervision.service";

export const READING_LIST_LIMIT = 100;

export type ReadingRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    project_id: string | null;
    document_id: string | null;
    version_id: string | null;
    swapped: boolean;
    status: TrainingReadingStatus;
    findings: string | null;
    submitted_at: string | null;
    machine_findings: TrainingReadingMachineFinding[] | null;
    comparison: TrainingReadingComparison | null;
    model_provider: string | null;
    model: string | null;
    credential_ref: string | null;
    created_at: string;
    updated_at: string;
};

export const readingNotFound = () => failure("not_found", LEARNING_NOT_FOUND);

/** A comparison still running after too long is shown as failed: its call was lost. */
export function effectiveReadingStatus(row: Pick<ReadingRow, "status" | "updated_at">, now: number = Date.now()) {
    return row.status === "comparing" && now - Date.parse(row.updated_at) >= SUPERVISION_STALE_MS
        ? ("failed" as const)
        : row.status;
}

/** The wire form: no document title, no credential reference. */
export function serializeReading(row: ReadingRow, now: number = Date.now()): TrainingReading {
    return {
        id: row.id,
        org_id: row.org_id,
        trainee_user_id: row.trainee_user_id,
        project_id: row.project_id ?? null,
        status: effectiveReadingStatus(row, now),
        swapped: row.swapped === true,
        findings: row.findings ?? null,
        submitted_at: row.submitted_at ?? null,
        machine_findings: row.machine_findings ?? null,
        comparison: row.comparison ?? null,
        model_provider: row.model_provider ?? null,
        model: row.model ?? null,
        created_at: row.created_at,
    };
}

/** A person's readings in an organization, newest first. No access check. */
export async function readReadings(db: Db, orgId: string, traineeId: string): Promise<ServiceResult<ReadingRow[]>> {
    const { data, error } = await db
        .from("training_readings")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(READING_LIST_LIMIT);
    if (error) return internalFailure(error);
    return ok((data ?? []) as unknown as ReadingRow[]);
}

/** The caller's own reading `readingId`, or null: someone else's is the same as none. */
export async function loadOwnReading(
    db: Db,
    args: { userId: string; readingId: unknown },
): Promise<ServiceResult<ReadingRow | null>> {
    if (typeof args.readingId !== "string" || !isUuid(args.readingId)) return ok(null);
    const { data, error } = await db
        .from("training_readings")
        .select("*")
        .eq("id", args.readingId)
        .eq("trainee_user_id", args.userId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as unknown as ReadingRow | null) ?? null);
}

/** Whether the person holds the junior stage anywhere in the organization. */
export async function isJuniorIn(db: Db, orgId: string, userId: string): Promise<ServiceResult<boolean>> {
    const { data, error } = await db
        .from("training_stages")
        .select("stage")
        .eq("org_id", orgId)
        .eq("trainee_user_id", userId);
    if (error) return internalFailure(error);
    return ok(((data ?? []) as { stage: string }[]).some((row) => row.stage === "junior"));
}
