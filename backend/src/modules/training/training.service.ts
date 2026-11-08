// LiTT training (docs/training.md): mentors, their pupils and each pupil's
// stage per practice area, inside a team organization.
//
// The module's facade and, being small, its implementation. Every function
// takes `db` plus the acting user, enforces the rules below and returns a
// ServiceResult; nothing here touches req/res.
//
//   designate / retire a mentor        owner or admin; a mentor with pupils
//                                      is not retired
//   take a member as pupil             a mentor, when the member has none;
//                                      moving a pupil to another mentor is
//                                      for an owner or admin
//   set / remove a stage               the pupil's current mentor only
//   release a pupil                    their mentor, or an owner or admin
//   read                               the pupil sees their mentor and
//                                      stages; a mentor sees their pupils';
//                                      an owner or admin sees who mentors
//                                      whom, never the stages
//
// Each change writes one insert-only audit event: the action, the
// organization, the actor and the affected user. Never the stage, the practice
// area or the mentor: those are learning data (docs/training.md).

import type {
    TrainingEffectiveStage,
    TrainingMembership,
    TrainingMyPupils,
    TrainingOrgOverview,
    TrainingStage,
    TrainingStageEntry,
} from "@mike/contracts";
import { checkProjectAccess, getOrgRole, isOrgAdmin, type OrgRole } from "../../lib/access";
import { recordAudit } from "../../lib/audit";
import { isPersonalOrg } from "../../lib/personalOrgs";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    isStorablePractice,
    isTrainingStage,
    normalizePractice,
    resolveWordTrainingStage,
    TRAINING_PRACTICE_MAX_CHARS,
    type TrainingScope,
} from "../../lib/training";
import { resolveTurnTraining } from "../../lib/trainingPass";
import { isUuid } from "../../lib/uuid";

type Actor = { actorId: string; actorEmail?: string | null; orgId: string };

const NOT_FOUND = "Organization not found";

type PupilRow = { trainee_user_id: string; mentor_user_id: string };

/** The actor's role in a team organization, or a 404 for anything else. */
async function teamRole(
    db: Db,
    actor: Actor,
): Promise<ServiceResult<OrgRole>> {
    if (!isUuid(actor.orgId)) return failure("not_found", NOT_FOUND);
    try {
        if (await isPersonalOrg(db, actor.orgId)) return failure("not_found", NOT_FOUND);
    } catch (error) {
        return internalFailure(error);
    }
    const role = await getOrgRole(actor.actorId, actor.orgId, db);
    return role ? ok(role) : failure("not_found", NOT_FOUND);
}

async function isMentor(db: Db, orgId: string, userId: string): Promise<ServiceResult<boolean>> {
    const { data, error } = await db
        .from("training_mentors")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok(!!data);
}

async function loadPupil(db: Db, orgId: string, userId: string): Promise<ServiceResult<PupilRow | null>> {
    const { data, error } = await db
        .from("training_pupils")
        .select("trainee_user_id, mentor_user_id")
        .eq("org_id", orgId)
        .eq("trainee_user_id", userId)
        .maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as PupilRow | null) ?? null);
}

function audit(
    db: Db,
    actor: Actor,
    action: string,
    affectedUserId: string,
): Promise<void> {
    return recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail ?? null,
        orgId: actor.orgId,
        action,
        surface: "organization",
        detail: { org_id: actor.orgId, target_user_id: affectedUserId },
    });
}

function readUserId(value: unknown): string | null {
    return typeof value === "string" && isUuid(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The caller's own training, organization by organization. */
export async function getMyTraining(
    db: Db,
    args: { userId: string },
): Promise<ServiceResult<{ memberships: TrainingMembership[] }>> {
    const [mentors, pupils, stages] = await Promise.all([
        db.from("training_mentors").select("org_id").eq("user_id", args.userId),
        db
            .from("training_pupils")
            .select("org_id, mentor_user_id")
            .eq("trainee_user_id", args.userId),
        db
            .from("training_stages")
            .select("org_id, practice, stage")
            .eq("trainee_user_id", args.userId),
    ]);
    const error = mentors.error ?? pupils.error ?? stages.error;
    if (error) return internalFailure(error);
    const byOrg = new Map<string, TrainingMembership>();
    const entry = (orgId: string) => {
        let found = byOrg.get(orgId);
        if (!found) {
            found = { org_id: orgId, is_mentor: false, mentor_user_id: null, stages: [] };
            byOrg.set(orgId, found);
        }
        return found;
    };
    for (const row of (mentors.data ?? []) as { org_id: string }[]) entry(row.org_id).is_mentor = true;
    for (const row of (pupils.data ?? []) as { org_id: string; mentor_user_id: string }[])
        entry(row.org_id).mentor_user_id = row.mentor_user_id;
    for (const row of (stages.data ?? []) as { org_id: string; practice: string | null; stage: TrainingStage }[])
        entry(row.org_id).stages.push({ practice: row.practice, stage: row.stage });
    return ok({ memberships: [...byOrg.values()] });
}

/**
 * The caller's effective stage where a chat turn would happen: in an
 * organization (and project), or in the Word add-in, and whether a turn there
 * needs their attempt (an urgency pass on the project lifts it; Word has no
 * project, so no pass). The server applies the same answer to the turn
 * itself; this only tells the client what to show.
 */
export async function getEffectiveTrainingStage(
    db: Db,
    args: {
        userId: string;
        userEmail?: string | null;
        orgId?: unknown;
        projectId?: unknown;
        surface?: unknown;
    },
): Promise<ServiceResult<TrainingEffectiveStage>> {
    let scope: TrainingScope;
    if (args.surface === "word") {
        // No organization or project in Word: the one Word rule decides.
        try {
            const { stage } = await resolveWordTrainingStage(db, args.userId);
            const required = stage === "pasante";
            return ok({
                stage,
                attempt_required: required,
                confidence_required: required,
                urgency_pass: null,
            });
        } catch (error) {
            return internalFailure(error);
        }
    } else {
        const orgId = readUserId(args.orgId);
        const projectId = readUserId(args.projectId);
        if (args.projectId !== undefined && args.projectId !== null && args.projectId !== "") {
            // The project decides the organization, and only somebody who
            // can open it learns anything about it.
            if (!projectId) return failure("not_found", "Project not found");
            let access;
            try {
                access = await checkProjectAccess(projectId, args.userId, args.userEmail, db);
            } catch (error) {
                return internalFailure(error);
            }
            if (!access.ok) return failure("not_found", "Project not found");
            scope = { orgId: access.project.org_id ?? null, projectId };
        } else scope = { orgId };
    }
    try {
        const turn = await resolveTurnTraining(db, args.userId, scope);
        return ok({
            stage: turn.stage,
            attempt_required: turn.attemptRequired,
            // The thermometer mark is owed with the approach, no more and no less.
            confidence_required: turn.attemptRequired,
            urgency_pass:
                turn.passExpiresAt && scope.projectId
                    ? { project_id: scope.projectId, expires_at: turn.passExpiresAt }
                    : null,
        });
    } catch (error) {
        return internalFailure(error);
    }
}

/** Who mentors whom in an organization, for its owners and admins. */
export async function getOrgTraining(
    db: Db,
    actor: Actor,
): Promise<ServiceResult<TrainingOrgOverview>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    if (!isOrgAdmin(role.data))
        return failure("forbidden", "Only an organization owner or admin can do that.");
    const [mentors, pupils] = await Promise.all([
        db.from("training_mentors").select("user_id").eq("org_id", actor.orgId),
        db
            .from("training_pupils")
            .select("trainee_user_id, mentor_user_id")
            .eq("org_id", actor.orgId),
    ]);
    const error = mentors.error ?? pupils.error;
    if (error) return internalFailure(error);
    return ok({
        mentors: ((mentors.data ?? []) as { user_id: string }[]).map((row) => row.user_id),
        pupils: (pupils.data ?? []) as PupilRow[],
    });
}

/** A mentor's pupils with their stages, and the members they could take on. */
export async function getMyPupils(
    db: Db,
    actor: Actor,
): Promise<ServiceResult<TrainingMyPupils>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    const mentor = await isMentor(db, actor.orgId, actor.actorId);
    if (!mentor.ok) return mentor;
    if (!mentor.data) return failure("forbidden", "Only a mentor can do that.");
    const [pupils, members, assigned] = await Promise.all([
        db
            .from("training_pupils")
            .select("trainee_user_id")
            .eq("org_id", actor.orgId)
            .eq("mentor_user_id", actor.actorId),
        db.from("org_members").select("user_id, role").eq("org_id", actor.orgId),
        db.from("training_pupils").select("trainee_user_id").eq("org_id", actor.orgId),
    ]);
    const error = pupils.error ?? members.error ?? assigned.error;
    if (error) return internalFailure(error);
    const pupilIds = ((pupils.data ?? []) as { trainee_user_id: string }[]).map(
        (row) => row.trainee_user_id,
    );
    const stagesByPupil = new Map<string, TrainingStageEntry[]>(pupilIds.map((id) => [id, []]));
    if (pupilIds.length > 0) {
        const { data, error: stagesError } = await db
            .from("training_stages")
            .select("trainee_user_id, practice, stage")
            .eq("org_id", actor.orgId)
            .in("trainee_user_id", pupilIds);
        if (stagesError) return internalFailure(stagesError);
        for (const row of (data ?? []) as { trainee_user_id: string; practice: string | null; stage: TrainingStage }[])
            stagesByPupil.get(row.trainee_user_id)?.push({ practice: row.practice, stage: row.stage });
    }
    const taken = new Set(
        ((assigned.data ?? []) as { trainee_user_id: string }[]).map((row) => row.trainee_user_id),
    );
    return ok({
        pupils: pupilIds.map((id) => ({ user_id: id, stages: stagesByPupil.get(id) ?? [] })),
        candidates: ((members.data ?? []) as { user_id: string; role: string }[])
            .filter((row) => row.role === "member")
            .map((row) => row.user_id)
            .filter((id) => id !== actor.actorId && !taken.has(id)),
    });
}

// ---------------------------------------------------------------------------
// Mentors
// ---------------------------------------------------------------------------

export async function designateMentor(
    db: Db,
    actor: Actor & { userId: unknown },
): Promise<ServiceResult<{ user_id: string }>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    if (!isOrgAdmin(role.data))
        return failure("forbidden", "Only an organization owner or admin can do that.");
    const userId = readUserId(actor.userId);
    if (!userId) return failure("validation", "Choose a member of this organization.");
    if (!(await getOrgRole(userId, actor.orgId, db)))
        return failure("validation", "Choose a member of this organization.");
    const existing = await isMentor(db, actor.orgId, userId);
    if (!existing.ok) return existing;
    if (existing.data) return ok({ user_id: userId });
    const { error } = await db.from("training_mentors").insert({
        org_id: actor.orgId,
        user_id: userId,
        designated_by: actor.actorId,
    });
    if (error) {
        if (error.code === "23505") return ok({ user_id: userId });
        return internalFailure(error);
    }
    await audit(db, actor, "training.mentor_designated", userId);
    return ok({ user_id: userId });
}

export async function removeMentor(
    db: Db,
    actor: Actor & { userId: string },
): Promise<ServiceResult<null>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    if (!isOrgAdmin(role.data))
        return failure("forbidden", "Only an organization owner or admin can do that.");
    if (!isUuid(actor.userId)) return failure("not_found", "Mentor not found");
    const { data: pupils, error: pupilsError } = await db
        .from("training_pupils")
        .select("trainee_user_id")
        .eq("org_id", actor.orgId)
        .eq("mentor_user_id", actor.userId)
        .limit(1);
    if (pupilsError) return internalFailure(pupilsError);
    if ((pupils ?? []).length > 0)
        return mentorHasPupils();
    const { data, error } = await db
        .from("training_mentors")
        .delete()
        .eq("org_id", actor.orgId)
        .eq("user_id", actor.userId)
        .select("user_id");
    if (error) {
        // A pupil assigned in the meantime: the foreign key refuses.
        if (error.code === "23503") return mentorHasPupils();
        return internalFailure(error);
    }
    if ((data ?? []).length === 0) return failure("not_found", "Mentor not found");
    await audit(db, actor, "training.mentor_removed", actor.userId);
    return ok(null);
}

function mentorHasPupils() {
    return failure(
        "conflict",
        "This mentor still has pupils. Release them or move them to another mentor first.",
        "training_mentor_has_pupils",
    );
}

// ---------------------------------------------------------------------------
// Pupils
// ---------------------------------------------------------------------------

/**
 * Take a member as pupil. A mentor takes a member who has none, for
 * themselves. An owner or admin may name any mentor, and may move a pupil
 * who already has one.
 */
export async function assignPupil(
    db: Db,
    actor: Actor & { userId: unknown; mentorUserId?: unknown },
): Promise<ServiceResult<PupilRow>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    const admin = isOrgAdmin(role.data);
    const traineeId = readUserId(actor.userId);
    if (!traineeId) return failure("validation", "Choose a member of this organization.");
    const mentorId =
        actor.mentorUserId === undefined || actor.mentorUserId === null || actor.mentorUserId === ""
            ? actor.actorId
            : readUserId(actor.mentorUserId);
    if (!mentorId) return failure("validation", "Choose a mentor of this organization.");
    if (mentorId !== actor.actorId && !admin)
        return failure("forbidden", "Only an organization owner or admin can do that.");
    if (traineeId === mentorId) return failure("validation", "Nobody can be their own pupil.");

    const mentor = await isMentor(db, actor.orgId, mentorId);
    if (!mentor.ok) return mentor;
    if (!mentor.data)
        return mentorId === actor.actorId
            ? failure("forbidden", "Only a mentor can do that.")
            : failure("validation", "Choose a mentor of this organization.");
    const traineeRole = await getOrgRole(traineeId, actor.orgId, db);
    if (!traineeRole) return failure("validation", "Choose a member of this organization.");
    // Only a plain member can be a pupil, never an owner or an admin.
    if (traineeRole !== "member")
        return failure("validation", "Only members with the member role can be pupils.");

    const current = await loadPupil(db, actor.orgId, traineeId);
    if (!current.ok) return current;
    if (current.data) {
        if (current.data.mentor_user_id === mentorId) return ok(current.data);
        // A reassignment never lands on whoever makes it.
        if (admin && mentorId === actor.actorId)
            return failure("forbidden", "You cannot move a pupil to yourself.");
        if (!admin)
            return failure(
                "conflict",
                "This member already has a mentor. An owner or admin can move them.",
                "training_pupil_has_mentor",
            );
        const { error } = await db
            .from("training_pupils")
            .update({
                mentor_user_id: mentorId,
                assigned_by: actor.actorId,
                updated_at: new Date().toISOString(),
            })
            .eq("org_id", actor.orgId)
            .eq("trainee_user_id", traineeId);
        if (error) return internalFailure(error);
    } else {
        const { error } = await db.from("training_pupils").insert({
            org_id: actor.orgId,
            trainee_user_id: traineeId,
            mentor_user_id: mentorId,
            assigned_by: actor.actorId,
        });
        if (error) {
            if (error.code === "23505")
                return failure(
                    "conflict",
                    "This member already has a mentor. An owner or admin can move them.",
                    "training_pupil_has_mentor",
                );
            return internalFailure(error);
        }
    }
    await audit(db, actor, "training.pupil_assigned", traineeId);
    return ok({ trainee_user_id: traineeId, mentor_user_id: mentorId });
}

/** Release a pupil: their mentor and every stage go. */
export async function releasePupil(
    db: Db,
    actor: Actor & { userId: string },
): Promise<ServiceResult<null>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    if (!isUuid(actor.userId)) return failure("not_found", "Pupil not found");
    const current = await loadPupil(db, actor.orgId, actor.userId);
    if (!current.ok) return current;
    if (!current.data) return failure("not_found", "Pupil not found");
    const mine = current.data.mentor_user_id === actor.actorId;
    // An owner or admin never releases themselves (a pupil promoted after
    // being taken keeps no way out of their own training).
    const admin = isOrgAdmin(role.data) && actor.userId !== actor.actorId;
    // Anybody else gets the same 404 as for a member who is not a pupil:
    // who is in training is not theirs to learn.
    if (!mine && !admin) return failure("not_found", "Pupil not found");
    const { error } = await db
        .from("training_pupils")
        .delete()
        .eq("org_id", actor.orgId)
        .eq("trainee_user_id", actor.userId);
    if (error) return internalFailure(error);
    await audit(db, actor, "training.pupil_released", actor.userId);
    return ok(null);
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The practice area of a request. Absent or null means every practice area;
 * anything else must be a real label: blank is a 400, never "all".
 */
export function readPractice(value: unknown): ServiceResult<string | null> {
    if (value === undefined || value === null) return ok(null);
    if (typeof value !== "string") return failure("validation", "Choose a practice area.");
    const practice = normalizePractice(value);
    if (!practice) return failure("validation", "Choose a practice area.");
    if (practice.length > TRAINING_PRACTICE_MAX_CHARS)
        return failure("validation", "That practice area name is too long.");
    if (!isStorablePractice(value)) return failure("validation", "Choose a practice area.");
    return ok(practice);
}

/** Only the pupil's current mentor sets or removes their stages. */
async function requireCurrentMentor(
    db: Db,
    actor: Actor & { userId: string },
): Promise<ServiceResult<null>> {
    const role = await teamRole(db, actor);
    if (!role.ok) return role;
    if (!isUuid(actor.userId)) return failure("not_found", "Pupil not found");
    const current = await loadPupil(db, actor.orgId, actor.userId);
    if (!current.ok) return current;
    if (!current.data) return failure("not_found", "Pupil not found");
    if (current.data.mentor_user_id !== actor.actorId) {
        // Only the pupil and the organization's owners and admins may learn
        // that this member is in training; to everybody else it is a 404.
        const knows = actor.actorId === actor.userId || isOrgAdmin(role.data);
        return knows
            ? failure("forbidden", "Only the pupil's mentor can do that.")
            : failure("not_found", "Pupil not found");
    }
    return ok(null);
}

export async function setStage(
    db: Db,
    actor: Actor & { userId: string; practice: unknown; stage: unknown },
): Promise<ServiceResult<TrainingStageEntry>> {
    const gate = await requireCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const practice = readPractice(actor.practice);
    if (!practice.ok) return practice;
    if (!isTrainingStage(actor.stage)) return failure("validation", "Choose pasante or junior.");
    const stage = actor.stage;
    let lookup = db
        .from("training_stages")
        .select("id, stage")
        .eq("org_id", actor.orgId)
        .eq("trainee_user_id", actor.userId);
    lookup = practice.data === null ? lookup.is("practice", null) : lookup.eq("practice", practice.data);
    const { data: existing, error: lookupError } = await lookup.maybeSingle();
    if (lookupError) return internalFailure(lookupError);
    const previous = (existing as { id: string; stage: string } | null) ?? null;
    if (previous?.stage === stage) return ok({ practice: practice.data, stage });
    const now = new Date().toISOString();
    const { error } = previous
        ? await db
              .from("training_stages")
              .update({ stage, updated_by: actor.actorId, updated_at: now })
              .eq("id", previous.id)
        : await db.from("training_stages").insert({
              org_id: actor.orgId,
              trainee_user_id: actor.userId,
              practice: practice.data,
              stage,
              updated_by: actor.actorId,
              updated_at: now,
          });
    if (error) {
        if (error.code === "23505")
            return failure("conflict", "The stage changed meanwhile. Try again.");
        if (error.code === "23514") return failure("validation", "Choose a practice area.");
        return internalFailure(error);
    }
    await audit(db, actor, "training.stage_set", actor.userId);
    return ok({ practice: practice.data, stage });
}

export async function removeStage(
    db: Db,
    actor: Actor & { userId: string; practice: unknown },
): Promise<ServiceResult<null>> {
    const gate = await requireCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const practice = readPractice(actor.practice);
    if (!practice.ok) return practice;
    let query = db
        .from("training_stages")
        .delete()
        .eq("org_id", actor.orgId)
        .eq("trainee_user_id", actor.userId);
    query = practice.data === null ? query.is("practice", null) : query.eq("practice", practice.data);
    const { data, error } = await query.select("stage");
    if (error) return internalFailure(error);
    const removed = (data ?? []) as { stage: string }[];
    if (removed.length === 0) return failure("not_found", "Stage not found");
    await audit(db, actor, "training.stage_removed", actor.userId);
    return ok(null);
}
