// Gym attempts (docs/training.md, layer 4).
//
// Who: the pupil works on their own attempts and the pupil's CURRENT mentor
// assigns and reads them; every call asks the learning-data rule first
// (assertLearningAccess / assertCurrentMentor), so the owner, an admin and a
// former mentor get the same 404 as for nothing.
//
// The clock is the server's. `start` fixes deadline_at; every read or write
// of an attempt first runs closeIfExpired, which submits an overdue attempt
// with what was saved (submitted_at = deadline_at). There is no cron, and no
// write is accepted after the deadline. Until the attempt is submitted the
// pupil never receives `errors` or an explanation: only the paragraphs, the
// deadline, their findings and the hints already asked for. The audit gets
// identifiers only.

import type { TrainingGymAttempt, TrainingGymError, TrainingGymFinding } from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { checkGymFindings, scoreGymAttempt } from "../../lib/trainingGym";
import { isUuid } from "../../lib/uuid";
import {
    assertCurrentMentor,
    assertLearningAccess,
    LEARNING_NOT_FOUND,
} from "../training-supervision/trainingSupervision.service";
import { loadOwnCase } from "./trainingGym.cases";

export const GYM_ATTEMPT_OPEN_CODE = "training_gym_attempt_open";
export const GYM_NOT_ASSIGNED_CODE = "training_gym_not_assigned";
export const GYM_CLOSED_CODE = "training_gym_closed";
export const GYM_NO_HINT_CODE = "training_gym_no_hint";

const ATTEMPT_LIST_LIMIT = 200;
const OPEN = "That case already has an attempt that is not submitted yet.";
const NOT_ASSIGNED = "This attempt was already started.";
const CLOSED = "This attempt is not open: it was submitted or its time ran out.";
const NOT_STARTED = "Start the attempt first.";
const NO_HINT = "There is no hint left for the paragraphs you have not marked.";
const CONFLICT = "The attempt changed at the same time. Try again.";

export type AttemptRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    case_id: string | null;
    title: string;
    practice: string;
    paragraphs: string[];
    errors: TrainingGymError[];
    time_limit_minutes: number;
    status: TrainingGymAttempt["status"];
    started_at: string | null;
    deadline_at: string | null;
    submitted_at: string | null;
    findings: TrainingGymFinding[];
    hints_used: number[];
    created_at: string;
    updated_at: string;
};

const notFound = () => failure("not_found", LEARNING_NOT_FOUND);
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The attempt as it goes out. Errors, explanations and the result only once
 * submitted; the mentor, who wrote the errors, always gets the errors.
 */
export function serializeAttempt(row: AttemptRow, forMentor: boolean, now: number = Date.now()): TrainingGymAttempt {
    const submitted = row.status === "submitted";
    return {
        id: row.id,
        org_id: row.org_id,
        trainee_user_id: row.trainee_user_id,
        case_id: row.case_id,
        title: row.title,
        practice: row.practice,
        paragraphs: row.paragraphs,
        time_limit_minutes: row.time_limit_minutes,
        status: row.status,
        started_at: row.started_at,
        deadline_at: row.deadline_at,
        submitted_at: row.submitted_at,
        server_now: iso(now),
        findings: row.findings,
        hints: row.hints_used.flatMap((index) => row.errors[index]?.hint ?? []),
        hints_used: row.hints_used.length,
        errors: submitted || forMentor ? row.errors : null,
        result: submitted ? scoreGymAttempt(row.errors, row.findings) : null,
        created_at: row.created_at,
    };
}

async function reload(db: Db, id: string): Promise<ServiceResult<AttemptRow | null>> {
    const { data, error } = await db.from("training_gym_attempts").select("*").eq("id", id).maybeSingle();
    if (error) return internalFailure(error);
    return ok((data as unknown as AttemptRow | null) ?? null);
}

/**
 * Past its deadline, an in-progress attempt is submitted with what it holds
 * (submitted_at = deadline_at). The update is conditional on the status it
 * read; when no row matched, someone else moved it and the row is read again.
 */
export async function closeIfExpired(db: Db, row: AttemptRow, now: number = Date.now()): Promise<ServiceResult<AttemptRow>> {
    if (row.status !== "in_progress" || !row.deadline_at || now <= Date.parse(row.deadline_at)) return ok(row);
    const { data, error } = await db
        .from("training_gym_attempts")
        .update({ status: "submitted", submitted_at: row.deadline_at, updated_at: iso(now) })
        .eq("id", row.id)
        .eq("status", "in_progress")
        .select("*");
    if (error) return internalFailure(error);
    const closed = ((data ?? []) as unknown as AttemptRow[])[0];
    if (closed) return ok(closed);
    const again = await reload(db, row.id);
    if (!again.ok) return again;
    return again.data ? ok(again.data) : notFound();
}

async function closeAll(db: Db, rows: readonly AttemptRow[]): Promise<ServiceResult<AttemptRow[]>> {
    const closed: AttemptRow[] = [];
    for (const row of rows) {
        const result = await closeIfExpired(db, row);
        if (!result.ok) return result;
        closed.push(result.data);
    }
    return ok(closed);
}

async function readAttempts(db: Db, orgId: string, traineeId: string): Promise<ServiceResult<AttemptRow[]>> {
    const { data, error } = await db
        .from("training_gym_attempts")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .order("created_at", { ascending: false })
        .limit(ATTEMPT_LIST_LIMIT);
    if (error) return internalFailure(error);
    return closeAll(db, (data ?? []) as unknown as AttemptRow[]);
}

// ---------------------------------------------------------------------------
// The pupil's current mentor
// ---------------------------------------------------------------------------

type Mentor = { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown };

/** GET …/pupils/:userId/gym/attempts */
export async function listPupilAttempts(db: Db, actor: Mentor): Promise<ServiceResult<TrainingGymAttempt[]>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const rows = await readAttempts(db, gate.data.orgId, gate.data.traineeId);
    if (!rows.ok) return rows;
    const now = Date.now();
    return ok(rows.data.map((row) => serializeAttempt(row, true, now)));
}

/**
 * POST …/pupils/:userId/gym/attempts: `{ case_id }`. Assigning and giving
 * another attempt are the same call; it is refused (409) while an attempt of
 * that case is not submitted. The attempt keeps a copy of the case.
 */
export async function assignAttempt(db: Db, actor: Mentor & { body: unknown }): Promise<ServiceResult<TrainingGymAttempt>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const caseId = ((actor.body ?? {}) as { case_id?: unknown }).case_id;
    if (typeof caseId !== "string" || !isUuid(caseId)) return failure("validation", "Choose the case to assign.");
    const loaded = await loadOwnCase(db, { orgId, actorId: actor.actorId, caseId });
    if (!loaded.ok) return loaded;
    const source = loaded.data;
    if (!source) return notFound();

    const { data: openRows, error: openError } = await db
        .from("training_gym_attempts")
        .select("*")
        .eq("case_id", source.id)
        .eq("trainee_user_id", traineeId)
        .in("status", ["assigned", "in_progress"]);
    if (openError) return internalFailure(openError);
    // An overdue attempt is already submitted: closing it frees the case.
    const settled = await closeAll(db, (openRows ?? []) as unknown as AttemptRow[]);
    if (!settled.ok) return settled;
    if (settled.data.some((row) => row.status !== "submitted")) return failure("conflict", OPEN, GYM_ATTEMPT_OPEN_CODE);

    const { data, error } = await db
        .from("training_gym_attempts")
        .insert({
            org_id: orgId,
            trainee_user_id: traineeId,
            case_id: source.id,
            assigned_by: actor.actorId,
            title: source.title,
            practice: source.practice,
            paragraphs: source.paragraphs,
            errors: source.errors,
            time_limit_minutes: source.time_limit_minutes,
            status: "assigned",
            findings: [],
            hints_used: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();
    if (error) {
        if ((error as { code?: string }).code === "23505") return failure("conflict", OPEN, GYM_ATTEMPT_OPEN_CODE);
        return internalFailure(error);
    }
    const row = data as unknown as AttemptRow;
    await recordAudit(db, {
        userId: actor.actorId,
        userEmail: actor.actorEmail,
        orgId,
        action: "training.gym_assigned",
        surface: "organization",
        detail: { org_id: orgId, target_user_id: traineeId, attempt_id: row.id },
    });
    return ok(serializeAttempt(row, true));
}

// ---------------------------------------------------------------------------
// The pupil
// ---------------------------------------------------------------------------

type Person = { userId: string; userEmail: string | null };

const self = (db: Db, userId: string, orgId: unknown) =>
    assertLearningAccess(db, { actorId: userId, orgId, traineeId: userId });

/** GET /training/me/gym/attempts?org_id= */
export async function listOwnAttempts(db: Db, args: { userId: string; orgId: unknown }): Promise<ServiceResult<TrainingGymAttempt[]>> {
    const access = await self(db, args.userId, args.orgId);
    if (!access.ok) return access;
    const rows = await readAttempts(db, args.orgId as string, args.userId);
    if (!rows.ok) return rows;
    const now = Date.now();
    return ok(rows.data.map((row) => serializeAttempt(row, false, now)));
}

/** The caller's own attempt, closed if overdue, after the access rule; someone else's is none. */
async function loadOwn(db: Db, args: { userId: string; attemptId: unknown }): Promise<ServiceResult<AttemptRow>> {
    if (typeof args.attemptId !== "string" || !isUuid(args.attemptId)) return notFound();
    const { data, error } = await db
        .from("training_gym_attempts")
        .select("*")
        .eq("id", args.attemptId)
        .eq("trainee_user_id", args.userId)
        .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return notFound();
    const row = data as unknown as AttemptRow;
    const access = await self(db, args.userId, row.org_id);
    if (!access.ok) return access;
    return closeIfExpired(db, row);
}

/** GET /training/me/gym/attempts/:id */
export async function getOwnAttempt(db: Db, args: { userId: string; attemptId: unknown }): Promise<ServiceResult<TrainingGymAttempt>> {
    const row = await loadOwn(db, args);
    return row.ok ? ok(serializeAttempt(row.data, false)) : row;
}

/** An update that only lands on an attempt still in progress and before its deadline (and, with `token`, on the row last read). */
async function writeOpen(
    db: Db,
    row: AttemptRow,
    patch: Record<string, unknown>,
    token?: string,
): Promise<ServiceResult<AttemptRow>> {
    let query = db
        .from("training_gym_attempts")
        .update(patch)
        .eq("id", row.id)
        .eq("status", "in_progress")
        .gt("deadline_at", iso(Date.now()));
    if (token) query = query.eq("updated_at", token);
    const { data, error } = await query.select("*");
    if (error) return internalFailure(error);
    const written = ((data ?? []) as unknown as AttemptRow[])[0];
    if (written) return ok(written);
    // Nothing matched: it closed (or changed) in between.
    const again = await reload(db, row.id);
    if (!again.ok) return again;
    if (!again.data) return notFound();
    const closed = await closeIfExpired(db, again.data);
    if (!closed.ok) return closed;
    return closed.data.status === "in_progress"
        ? failure("conflict", CONFLICT)
        : failure("conflict", CLOSED, GYM_CLOSED_CODE);
}

/** POST /training/me/gym/attempts/:id/start: fixes the deadline. */
export async function startAttempt(db: Db, args: Person & { attemptId: unknown }): Promise<ServiceResult<TrainingGymAttempt>> {
    const loaded = await loadOwn(db, args);
    if (!loaded.ok) return loaded;
    const row = loaded.data;
    if (row.status !== "assigned") return failure("conflict", NOT_ASSIGNED, GYM_NOT_ASSIGNED_CODE);
    const now = Date.now();
    const { data, error } = await db
        .from("training_gym_attempts")
        .update({
            status: "in_progress",
            started_at: iso(now),
            deadline_at: iso(now + row.time_limit_minutes * 60_000),
            updated_at: iso(now),
        })
        .eq("id", row.id)
        .eq("status", "assigned")
        .select("*");
    if (error) return internalFailure(error);
    const started = ((data ?? []) as unknown as AttemptRow[])[0];
    if (!started) return failure("conflict", NOT_ASSIGNED, GYM_NOT_ASSIGNED_CODE);
    return ok(serializeAttempt(started, false));
}

/** PUT /training/me/gym/attempts/:id/findings: `{ findings }`, the whole list. */
export async function saveFindings(
    db: Db,
    args: Person & { attemptId: unknown; body: unknown },
): Promise<ServiceResult<TrainingGymAttempt>> {
    const loaded = await loadOwn(db, args);
    if (!loaded.ok) return loaded;
    const row = loaded.data;
    if (row.status === "assigned") return failure("conflict", NOT_STARTED, GYM_NOT_ASSIGNED_CODE);
    if (row.status !== "in_progress") return failure("conflict", CLOSED, GYM_CLOSED_CODE);
    const checked = checkGymFindings(((args.body ?? {}) as { findings?: unknown }).findings, row.paragraphs.length);
    if (!checked.ok) return failure("validation", checked.detail);
    const written = await writeOpen(db, row, { findings: checked.value });
    return written.ok ? ok(serializeAttempt(written.data, false)) : written;
}

/**
 * POST /training/me/gym/attempts/:id/hint: the next hint the mentor wrote, in
 * the order of the errors, skipping the paragraphs already marked and the
 * ones already shown. Never the explanation. Each one is recorded.
 */
export async function revealHint(db: Db, args: Person & { attemptId: unknown }): Promise<ServiceResult<TrainingGymAttempt>> {
    const loaded = await loadOwn(db, args);
    if (!loaded.ok) return loaded;
    const row = loaded.data;
    if (row.status === "assigned") return failure("conflict", NOT_STARTED, GYM_NOT_ASSIGNED_CODE);
    if (row.status !== "in_progress") return failure("conflict", CLOSED, GYM_CLOSED_CODE);
    const marked = new Set(row.findings.map((finding) => finding.paragraph));
    const next = row.errors.findIndex(
        (error, index) => !!error.hint && !marked.has(error.paragraph) && !row.hints_used.includes(index),
    );
    if (next < 0) return failure("conflict", NO_HINT, GYM_NO_HINT_CODE);
    // Two hints asked at once: only the one that read the current row lands.
    const written = await writeOpen(
        db,
        row,
        { hints_used: [...row.hints_used, next], updated_at: iso(Date.now()) },
        row.updated_at,
    );
    return written.ok ? ok(serializeAttempt(written.data, false)) : written;
}

/** POST /training/me/gym/attempts/:id/submit. Already submitted (by the deadline too): the result, unchanged. */
export async function submitAttempt(db: Db, args: Person & { attemptId: unknown }): Promise<ServiceResult<TrainingGymAttempt>> {
    const loaded = await loadOwn(db, args);
    if (!loaded.ok) return loaded;
    const row = loaded.data;
    if (row.status === "assigned") return failure("conflict", NOT_STARTED, GYM_NOT_ASSIGNED_CODE);
    if (row.status === "submitted") return ok(serializeAttempt(row, false));
    const now = iso(Date.now());
    const { data, error } = await db
        .from("training_gym_attempts")
        .update({ status: "submitted", submitted_at: now, updated_at: now })
        .eq("id", row.id)
        .eq("status", "in_progress")
        .gt("deadline_at", now)
        .select("*");
    if (error) return internalFailure(error);
    const submitted = ((data ?? []) as unknown as AttemptRow[])[0];
    if (!submitted) {
        // The deadline passed on the way: it is submitted at the deadline.
        const again = await reload(db, row.id);
        if (!again.ok) return again;
        if (!again.data) return notFound();
        const closed = await closeIfExpired(db, again.data);
        if (!closed.ok) return closed;
        if (closed.data.status !== "submitted") return failure("conflict", CONFLICT);
        return ok(serializeAttempt(closed.data, false));
    }
    await recordAudit(db, {
        userId: args.userId,
        userEmail: args.userEmail,
        orgId: submitted.org_id,
        action: "training.gym_submitted",
        surface: "organization",
        detail: { org_id: submitted.org_id, target_user_id: args.userId, attempt_id: submitted.id },
    });
    return ok(serializeAttempt(submitted, false));
}
