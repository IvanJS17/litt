// LiTT training, layer 2 (docs/training.md): the urgency pass.
//
// A pupil's current mentor may lift «Tu turno primero» for one matter's
// project and a limited time (training_urgency_passes). The pass changes what
// a chat TURN requires, never the stage: resolveTrainingStage still decides
// the seal of the output lock, its approvals and the AI review's approved
// report, so what a pasante produces during a pass stays a pasante's draft
// that needs approval before it leaves.
//
// Contract for later layers: AI behavior that depends on the stage reads
// resolveTurnTraining; the seal and the approvals read resolveTrainingStage.

import type { TrainingStage } from "@mike/contracts";
import { resolveTrainingStage, type TrainingScope } from "./training";
import type { Db } from "./supabase";

/** The shortest pass a mentor may grant. */
export const URGENCY_PASS_MIN_MINUTES = 30;
/** What a pass lasts when the mentor does not say. */
export const URGENCY_PASS_DEFAULT_MINUTES = 8 * 60;
/** The longest pass; more time is another pass, which the audit records. */
export const URGENCY_PASS_MAX_MINUTES = 72 * 60;
/** How many passes may be in force for one pupil at once. */
export const URGENCY_PASS_MAX_ACTIVE = 5;

export const URGENCY_PASS_REASONS = ["plazo", "audiencia", "cliente_urgente", "otro"] as const;

export type TurnTraining = {
    /** The raw effective stage: the one the output lock uses. */
    stage: TrainingStage | null;
    passActive: boolean;
    /** When the pass in force ends (the latest, when several are). */
    passExpiresAt: string | null;
    /** Whether the turn must carry the pupil's own attempt. */
    attemptRequired: boolean;
};

type PassRow = {
    org_id?: unknown;
    trainee_user_id?: unknown;
    project_id?: unknown;
    starts_at?: unknown;
    expires_at?: unknown;
    revoked_at?: unknown;
};

/** Whether a stored pass is in force at `now`: not revoked, started, not ended. */
export function isUrgencyPassActive(row: PassRow, now: Date): boolean {
    if (row.revoked_at !== null && row.revoked_at !== undefined) return false;
    if (typeof row.starts_at !== "string" || typeof row.expires_at !== "string") return false;
    const starts = Date.parse(row.starts_at);
    const expires = Date.parse(row.expires_at);
    return starts <= now.getTime() && now.getTime() < expires;
}

/**
 * The end of the pass in force for this pupil in this organization's
 * project, or null. A read failure answers null, the safe side (the attempt
 * is asked for), and is logged without data; the stage itself, unlike this,
 * fails the turn when it cannot be read.
 */
async function activePassExpiry(
    db: Db,
    userId: string,
    orgId: string,
    projectId: string,
    now: Date,
): Promise<string | null> {
    try {
        const { data, error } = await db
            .from("training_urgency_passes")
            .select("org_id, trainee_user_id, project_id, starts_at, expires_at, revoked_at")
            .eq("org_id", orgId)
            .eq("trainee_user_id", userId)
            .eq("project_id", projectId)
            .is("revoked_at", null)
            .lte("starts_at", now.toISOString())
            .gt("expires_at", now.toISOString());
        if (error) throw error;
        const rows = Array.isArray(data) ? (data as PassRow[]) : [];
        let latest: string | null = null;
        for (const row of rows) {
            // The filters above are the rule; this re-check keeps a row that
            // is not this pupil's, this project's or in force from counting.
            if (row.org_id !== orgId || row.trainee_user_id !== userId || row.project_id !== projectId)
                continue;
            if (!isUrgencyPassActive(row, now)) continue;
            const expires = row.expires_at as string;
            if (!latest || Date.parse(expires) > Date.parse(latest)) latest = expires;
        }
        return latest;
    } catch {
        console.warn("[training] urgency pass read failed; asking for the attempt");
        return null;
    }
}

/**
 * What a chat turn requires of its author where it runs. Only a pasante
 * working in a project (a matter) can hold a pass, so nobody else's turn
 * reads the passes. A stage read failure throws, as resolveTrainingStage does.
 */
export async function resolveTurnTraining(
    db: Db,
    userId: string,
    scope: TrainingScope,
    now: Date = new Date(),
): Promise<TurnTraining> {
    const stage = await resolveTrainingStage(db, userId, scope);
    const passExpiresAt =
        stage === "pasante" && scope.orgId && scope.projectId
            ? await activePassExpiry(db, userId, scope.orgId, scope.projectId, now)
            : null;
    const passActive = passExpiresAt !== null;
    return {
        stage,
        passActive,
        passExpiresAt,
        attemptRequired: stage === "pasante" && !passActive,
    };
}

/** The stage the turn check applies: none while a pass is in force. */
export function turnStage(turn: TurnTraining): TrainingStage | null {
    return turn.passActive ? null : turn.stage;
}
