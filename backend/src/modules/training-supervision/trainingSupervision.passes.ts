// LiTT training layer 2: urgency passes (docs/training.md).
//
// A pupil's CURRENT mentor grants a pass for one project of the organization
// and a limited time; while it is in force a pasante's turn there does not
// need «Tu turno primero» (lib/trainingPass.ts). The output lock is not
// touched: what the pupil produces is still sealed and needs approval.
//
//   grant    the current mentor; mentor and pupil can both open the project;
//            30 min to 72 h (8 h when omitted); at most 5 in force
//   revoke   the current mentor
//   list     the current mentor here; the pupil through /training/me/supervision
//
// Anyone else gets the uniform 404 of assertLearningAccess. The audit gets who
// granted it, to whom, on which project, until when and the reason CODE; the
// free note is learning data and stays on the row.

import type {
    TrainingUrgencyPass,
    TrainingUrgencyPasses,
    TrainingUrgencyReason,
} from "@mike/contracts";
import { checkProjectAccess } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    URGENCY_PASS_DEFAULT_MINUTES,
    URGENCY_PASS_MAX_ACTIVE,
    URGENCY_PASS_MAX_MINUTES,
    URGENCY_PASS_MIN_MINUTES,
    URGENCY_PASS_REASONS,
} from "../../lib/trainingPass";
import { isUuid } from "../../lib/uuid";
import { assertCurrentMentor, LEARNING_NOT_FOUND } from "./trainingSupervision.access";

export const URGENCY_PASS_NOTE_MAX_CHARS = 500;

const PASS_COLUMNS =
    "id, org_id, trainee_user_id, project_id, starts_at, expires_at, reason_code, reason_note, revoked_at";
const PASS_LIST_LIMIT = 100;
const PROJECT_NOT_FOUND = "No encontramos ese asunto.";

type MentorArgs = { actorId: string; orgId: unknown; traineeId: unknown };

function toPass(row: Record<string, unknown>): TrainingUrgencyPass {
    return {
        id: row.id as string,
        org_id: row.org_id as string,
        trainee_user_id: row.trainee_user_id as string,
        project_id: row.project_id as string,
        starts_at: row.starts_at as string,
        expires_at: row.expires_at as string,
        reason_code: row.reason_code as TrainingUrgencyReason,
        reason_note: (row.reason_note as string | null) ?? null,
        revoked_at: (row.revoked_at as string | null) ?? null,
    };
}

/** A pupil's passes in an organization, newest first. No access check. */
export async function readUrgencyPasses(
    db: Db,
    orgId: string,
    traineeId: string,
): Promise<ServiceResult<TrainingUrgencyPass[]>> {
    const { data, error } = await db
        .from("training_urgency_passes")
        .select(PASS_COLUMNS)
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(PASS_LIST_LIMIT);
    if (error) return internalFailure(error);
    return ok(((data ?? []) as Record<string, unknown>[]).map(toPass));
}

export async function listUrgencyPasses(
    db: Db,
    args: MentorArgs,
): Promise<ServiceResult<TrainingUrgencyPasses>> {
    const access = await assertCurrentMentor(db, args);
    if (!access.ok) return access;
    const passes = await readUrgencyPasses(db, args.orgId as string, args.traineeId as string);
    if (!passes.ok) return passes;
    return ok({ passes: passes.data });
}

type GrantInput = {
    projectId: string;
    minutes: number;
    reasonCode: TrainingUrgencyReason;
    reasonNote: string | null;
};

function invalid(detail: string) {
    return failure("validation", detail, "training_pass_invalid");
}

/** The grant request as stored, or what is wrong with it (in Spanish). */
export function readGrantBody(body: unknown): ServiceResult<GrantInput> {
    const input = (body ?? {}) as Record<string, unknown>;
    if (typeof input.project_id !== "string" || !isUuid(input.project_id))
        return invalid("Elige el asunto del pase.");
    const minutes = input.duration_minutes ?? URGENCY_PASS_DEFAULT_MINUTES;
    if (
        typeof minutes !== "number" ||
        !Number.isInteger(minutes) ||
        minutes < URGENCY_PASS_MIN_MINUTES ||
        minutes > URGENCY_PASS_MAX_MINUTES
    )
        return invalid(
            `La duración del pase va de ${URGENCY_PASS_MIN_MINUTES} minutos a ${URGENCY_PASS_MAX_MINUTES / 60} horas.`,
        );
    if (!(URGENCY_PASS_REASONS as readonly unknown[]).includes(input.reason_code))
        return invalid("Elige el motivo del pase.");
    let reasonNote: string | null = null;
    if (input.reason_note !== undefined && input.reason_note !== null) {
        if (typeof input.reason_note !== "string") return invalid("La nota del motivo debe ser texto.");
        const note = input.reason_note.trim();
        if ([...note].length > URGENCY_PASS_NOTE_MAX_CHARS)
            return invalid(`La nota del motivo admite hasta ${URGENCY_PASS_NOTE_MAX_CHARS} caracteres.`);
        reasonNote = note || null;
    }
    return ok({
        projectId: input.project_id,
        minutes,
        reasonCode: input.reason_code as TrainingUrgencyReason,
        reasonNote,
    });
}

export async function grantUrgencyPass(
    db: Db,
    args: MentorArgs & { actorEmail?: string | null; body: unknown },
): Promise<ServiceResult<TrainingUrgencyPass>> {
    const access = await assertCurrentMentor(db, args);
    if (!access.ok) return access;
    const orgId = args.orgId as string;
    const traineeId = args.traineeId as string;
    const input = readGrantBody(args.body);
    if (!input.ok) return input;
    const { projectId } = input.data;

    // The mentor may not hand out a pass on a matter they cannot open, and a
    // pass is useless to a pupil who cannot open it. Organization projects
    // decide access by membership, so the pupil needs no e-mail here.
    let mentorAccess;
    let pupilAccess;
    try {
        mentorAccess = await checkProjectAccess(projectId, args.actorId, args.actorEmail, db);
        if (!mentorAccess.ok || mentorAccess.project.org_id !== orgId)
            return failure("not_found", PROJECT_NOT_FOUND);
        pupilAccess = await checkProjectAccess(projectId, traineeId, null, db);
    } catch (error) {
        return internalFailure(error);
    }
    if (!pupilAccess.ok)
        return failure(
            "conflict",
            "Tu pupilo no puede abrir este asunto; dale acceso antes de concederle el pase.",
            "training_pass_pupil_no_access",
        );

    const { data, error } = await db.rpc("training_grant_urgency_pass", {
        p_actor: args.actorId,
        p_org: orgId,
        p_trainee: traineeId,
        p_project: projectId,
        p_duration_minutes: input.data.minutes,
        p_reason_code: input.data.reasonCode,
        p_reason_note: input.data.reasonNote,
        p_max_active: URGENCY_PASS_MAX_ACTIVE,
    });
    if (error) return internalFailure(error);
    const result = (data ?? {}) as { outcome?: string; pass?: Record<string, unknown> };
    switch (result.outcome) {
        case "granted":
            break;
        case "project_not_found":
            return failure("not_found", PROJECT_NOT_FOUND);
        case "duplicate":
            return failure(
                "conflict",
                "Ese pase ya está concedido.",
                "training_pass_duplicate",
            );
        case "limit":
            return failure(
                "conflict",
                `Tu pupilo ya tiene ${URGENCY_PASS_MAX_ACTIVE} pases vigentes; revoca uno antes de conceder otro.`,
                "training_pass_limit_reached",
            );
        case "invalid_duration":
            return invalid("La duración del pase no es válida.");
        default:
            // not_found: the mentor stopped being the current one meanwhile.
            return failure("not_found", LEARNING_NOT_FOUND);
    }
    const pass = toPass(result.pass ?? {});
    await recordAudit(db, {
        userId: args.actorId,
        userEmail: args.actorEmail ?? null,
        orgId,
        action: "training.urgency_pass_granted",
        surface: "organization",
        projectId,
        detail: {
            org_id: orgId,
            target_user_id: traineeId,
            expires_at: pass.expires_at,
            reason_code: pass.reason_code,
        },
    });
    return ok(pass);
}

/** Revoke a pass. Revoking one already revoked changes nothing. */
export async function revokeUrgencyPass(
    db: Db,
    args: MentorArgs & { actorEmail?: string | null; passId: unknown },
): Promise<ServiceResult<null>> {
    const access = await assertCurrentMentor(db, args);
    if (!access.ok) return access;
    if (typeof args.passId !== "string" || !isUuid(args.passId))
        return failure("not_found", LEARNING_NOT_FOUND);
    const orgId = args.orgId as string;
    const traineeId = args.traineeId as string;
    const { data, error } = await db
        .from("training_urgency_passes")
        .update({ revoked_at: new Date().toISOString(), revoked_by: args.actorId })
        .eq("id", args.passId)
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .is("revoked_at", null)
        .select("id, project_id");
    if (error) return internalFailure(error);
    const revoked = (data ?? []) as { id: string; project_id: string }[];
    if (revoked.length === 0) {
        const { data: existing, error: readError } = await db
            .from("training_urgency_passes")
            .select("id")
            .eq("id", args.passId)
            .eq("org_id", orgId)
            .eq("trainee_user_id", traineeId)
            .maybeSingle();
        if (readError) return internalFailure(readError);
        return existing ? ok(null) : failure("not_found", LEARNING_NOT_FOUND);
    }
    await recordAudit(db, {
        userId: args.actorId,
        userEmail: args.actorEmail ?? null,
        orgId,
        action: "training.urgency_pass_revoked",
        surface: "organization",
        projectId: revoked[0].project_id,
        detail: { org_id: orgId, target_user_id: traineeId },
    });
    return ok(null);
}
