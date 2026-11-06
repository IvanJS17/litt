// LiTT training (docs/training.md): which stage a person is in when they work
// in a given place, and what that asks of a chat turn.
//
// A stage (`pasante` or `junior`) belongs to a person, an organization and a
// practice area; a stage with no practice area covers all of them. Without
// a stage the person is a lawyer and nothing here changes their experience.
// The rows are written by modules/training; this file only reads them, so
// every surface that needs the effective stage resolves it the same way.

import type { TrainingStage } from "@mike/contracts";
import { AppError } from "./appError";
import type { Db } from "./supabase";

export type { TrainingStage };

export const TRAINING_STAGES: readonly TrainingStage[] = ["pasante", "junior"];

/** The shortest attempt a pasante may send, after trimming. */
export const TRAINING_ATTEMPT_MIN_CHARS = 60;
/** The longest attempt kept with a message (matches the column check). */
export const TRAINING_ATTEMPT_MAX_CHARS = 4000;
/** The longest practice-area label (matches the column check). */
export const TRAINING_PRACTICE_MAX_CHARS = 200;

export const TRAINING_ATTEMPT_REQUIRED_CODE = "training_attempt_required";

export function isTrainingStage(value: unknown): value is TrainingStage {
    return value === "pasante" || value === "junior";
}

/**
 * A practice area as stored and compared, and the only place it is
 * normalized: every run of whitespace (spaces, tabs, line breaks, NBSP, any
 * Unicode space) becomes one space, the ends are trimmed and the text is
 * lowercased; accents stay as typed. The result is also a fixed point of
 * SQL's lower(btrim(...)), which the column check requires. Blank or
 * non-string input gives null.
 */
export function normalizePractice(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/[\s\u00a0\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu, " ").trim().toLowerCase();
    return normalized ? normalized : null;
}

/**
 * Whether a practice label, as typed, may be stored: no control characters
 * (whitespace such as a tab is normalized away instead), and no
 * character whose lowercase form is more than one character (e.g. "İ"),
 * where JS and PostgreSQL lowercase differently.
 */
export function isStorablePractice(value: string): boolean {
    for (const char of value) {
        if (/\p{Cc}/u.test(char) && !/\s/u.test(char)) return false;
        if ([...char.toLowerCase()].length !== 1) return false;
    }
    return true;
}

export type TrainingStageRow = { practice: string | null; stage: string };

/**
 * The effective stage for a practice area: the exact practice area first,
 * then the stage that covers every practice area, otherwise none.
 */
export function pickEffectiveStage(
    rows: readonly TrainingStageRow[],
    practice: string | null,
): TrainingStage | null {
    const wanted = normalizePractice(practice);
    if (wanted) {
        const exact = rows.find((row) => normalizePractice(row.practice) === wanted);
        if (exact && isTrainingStage(exact.stage)) return exact.stage;
    }
    const general = rows.find((row) => row.practice === null);
    return general && isTrainingStage(general.stage) ? general.stage : null;
}

/**
 * Where a turn happens. `orgId` null is the personal space, where nobody has
 * a stage. `anyOrganization` is the Word add-in, whose chats belong to no
 * organization or project: there only a stage that covers every practice
 * area applies, from whichever organization the person holds it in, with
 * `pasante` taking precedence over `junior`.
 */
export type TrainingScope =
    | { orgId: string | null; projectId?: string | null }
    | { anyOrganization: true };

/**
 * The one resolver of a person's effective stage. A read failure throws:
 * answering "no stage" would let a pasante's turn skip what it requires.
 */
export async function resolveTrainingStage(
    db: Db,
    userId: string,
    scope: TrainingScope,
): Promise<TrainingStage | null> {
    if ("anyOrganization" in scope) {
        const { data, error } = await db
            .from("training_stages")
            .select("stage")
            .eq("trainee_user_id", userId)
            .is("practice", null);
        if (error) throw readFailure(error);
        const stages = ((data ?? []) as { stage: string }[]).map((row) => row.stage);
        if (stages.includes("pasante")) return "pasante";
        return stages.includes("junior") ? "junior" : null;
    }
    if (!scope.orgId) return null;
    const { data, error } = await db
        .from("training_stages")
        .select("practice, stage")
        .eq("org_id", scope.orgId)
        .eq("trainee_user_id", userId);
    if (error) throw readFailure(error);
    const rows = (data ?? []) as TrainingStageRow[];
    if (rows.length === 0) return null;
    const practice = scope.projectId
        ? await projectPractice(db, scope.projectId)
        : null;
    return pickEffectiveStage(rows, practice);
}

/** The project's practice area, or failing that its linked matter's. */
async function projectPractice(db: Db, projectId: string): Promise<string | null> {
    const { data: project, error } = await db
        .from("projects")
        .select("practice")
        .eq("id", projectId)
        .maybeSingle();
    if (error) throw readFailure(error);
    const own = normalizePractice((project as { practice?: unknown } | null)?.practice);
    if (own) return own;
    const { data: matter, error: matterError } = await db
        .from("matters")
        .select("practice")
        .eq("project_id", projectId)
        .maybeSingle();
    if (matterError) throw readFailure(matterError);
    return normalizePractice((matter as { practice?: unknown } | null)?.practice);
}

function readFailure(cause: unknown): AppError {
    return new AppError("db.query_failed", "Failed to read the training stage", { cause });
}

export type TrainingTurnCheck =
    | { ok: true; attempt: string | null }
    | { ok: false; status: 400; code: typeof TRAINING_ATTEMPT_REQUIRED_CODE; detail: string };

/**
 * What a user turn needs given the author's effective stage. A pasante's
 * turn carries their own attempt first; anybody else's `attempt` is ignored.
 */
export function checkTrainingTurn(
    stage: TrainingStage | null,
    attempt: unknown,
): TrainingTurnCheck {
    if (stage !== "pasante") return { ok: true, attempt: null };
    const text = typeof attempt === "string" ? attempt.trim() : "";
    if (text.length < TRAINING_ATTEMPT_MIN_CHARS || text.length > TRAINING_ATTEMPT_MAX_CHARS)
        return {
            ok: false,
            status: 400,
            code: TRAINING_ATTEMPT_REQUIRED_CODE,
            detail: `Escribe tu planteamiento antes de preguntar (mínimo ${TRAINING_ATTEMPT_MIN_CHARS} caracteres).`,
        };
    return { ok: true, attempt: text };
}
