// The person's own map, calibration, hints and retakes (docs/training.md,
// layer 3), read by the person and by their CURRENT mentor.
//
// Who: the person reads their own through the learning-data rule
// (assertLearningAccess); the mentor through assertCurrentMentor, and only
// from the works in matters they can open (the rest is counted, never used).
// Owners, admins, a previous mentor, another member and an outsider get the
// same 404 as an unknown id. It describes ONE person: counts of their own
// events, no score, average, percentage, ranking or comparison.
//
// Computed on read from the turn notes and the answered retakes
// (lib/trainingMap.ts, lib/trainingCalibration.ts): nothing is stored for it.

import type {
    TrainingHintsUsed,
    TrainingMyCriterion,
    TrainingPupilCriterion,
} from "@mike/contracts";
import { ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { computeCalibration } from "../../lib/trainingCalibration";
import {
    computeMap,
    countedTurns,
    labelFromNotes,
    MAP_MIN_EVENTS,
    MAP_WINDOW_EVENTS,
    mapEvents,
    RETAKE_AFTER_DAYS,
    type AnsweredRetake,
    type MapEvent,
} from "../../lib/trainingMap";
import { assertCurrentMentor, assertLearningAccess } from "../training-supervision/trainingSupervision.service";
import { loadEvidenceNotes, type EvidenceRow } from "../../lib/trainingEvidenceNotes";
import { visibleEvidence } from "./trainingCriterion.evidence";
import { retakeGeneration } from "./trainingCriterion.retakeRoute";
import { isLiveRetake, readRetakes, serializeRetake, type RetakeRow } from "./trainingCriterion.retakeRows";
import type { TrainingVerdict } from "../../lib/trainingVerdict";

export function answeredRetakes(rows: readonly RetakeRow[]): AnsweredRetake[] {
    return rows.flatMap((row) =>
        row.status === "answered" && row.verdict && row.answered_at
            ? [{ topic_key: row.topic_key, topic_label: row.topic_label, answered_at: row.answered_at, verdict: row.verdict as TrainingVerdict }]
            : [],
    );
}

/** A retake made from notes the reader may not see: its place and state, none of the text or the verdict computed from them. */
function withheldRetake(row: RetakeRow, now: number) {
    return { ...serializeRetake(row, now), topic_key: "", topic_label: "", question: null, answer: null, contrast: null, verdict: null, text_hidden: true };
}

/**
 * Of the retakes, those built only from notes the reader may see, with the
 * label read again from those notes (never the stored one, which the model
 * wrote from every source); the others are `hidden`.
 */
export function splitRetakes(retakes: readonly RetakeRow[], visibleRows: readonly EvidenceRow[]) {
    const openableNotes = new Set(visibleRows.map((row) => row.id));
    const notesById = new Map(visibleRows.map((row) => [row.id, row]));
    const shown: RetakeRow[] = [];
    const hidden: RetakeRow[] = [];
    for (const row of retakes) {
        const sources = row.source_note_ids ?? [];
        const label =
            sources.length > 0 && sources.every((id) => openableNotes.has(id))
                ? labelFromNotes(sources.map((id) => notesById.get(id)!), row.topic_key)
                : null;
        if (label) shown.push({ ...row, topic_label: label });
        else hidden.push(row);
    }
    return { shown, hidden };
}

function hintsUsed(rows: readonly EvidenceRow[]): TrainingHintsUsed {
    const hints = rows.filter((row) => row.mode === "hint");
    return { requested: hints.length, max_level: hints.reduce((top, row) => Math.max(top, row.step ?? 0), 0) };
}

/** The map events of a person's notes and answered retakes (also what a retake is asked from). */
export function eventsOf(rows: readonly EvidenceRow[], retakes: readonly RetakeRow[]): MapEvent[] {
    return mapEvents(countedTurns(rows), answeredRetakes(retakes));
}

function build(args: {
    orgId: string;
    traineeId: string;
    rows: readonly EvidenceRow[];
    retakes: readonly RetakeRow[];
    /** Retakes whose text the reader may not read: listed without it or its verdict; they hold no slot. */
    hiddenRetakes?: readonly RetakeRow[];
    now: number;
}) {
    const turns = countedTurns(args.rows);
    const events = mapEvents(turns, answeredRetakes(args.retakes));
    const open = args.retakes.find((row) => isLiveRetake(row, args.now));
    return {
        org_id: args.orgId,
        trainee_user_id: args.traineeId,
        map: {
            topics: computeMap(events, args.now).map((topic) => ({
                key: topic.key,
                label: topic.label,
                state: topic.state,
                events: topic.events,
                window_hits: topic.window_hits,
                window_size: topic.window_size,
                last_at: topic.last_at,
                last_verdict: topic.last_verdict,
                retake_due: topic.retake_due,
            })),
            min_events: MAP_MIN_EVENTS,
            window: MAP_WINDOW_EVENTS,
            retake_after_days: RETAKE_AFTER_DAYS,
        },
        calibration: computeCalibration(turns),
        hints: hintsUsed(args.rows),
        retakes: [
            ...args.retakes.map((row) => serializeRetake(row, args.now)),
            ...(args.hiddenRetakes ?? []).map((row) => withheldRetake(row, args.now)),
        ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        open_retake_id: open?.id ?? null,
    };
}

/** GET /training/me/criterion?org_id= */
export async function getMyCriterion(
    db: Db,
    args: { userId: string; userEmail?: string | null; orgId: unknown; now?: number },
): Promise<ServiceResult<TrainingMyCriterion>> {
    const access = await assertLearningAccess(db, { actorId: args.userId, orgId: args.orgId, traineeId: args.userId });
    if (!access.ok) return access;
    const orgId = args.orgId as string;
    const rows = await loadEvidenceNotes(db, { orgId, traineeId: args.userId });
    if (!rows.ok) return rows;
    // The person reads their map from the works they can still see: the same rule as their turn notes.
    const visible = await visibleEvidence(db, rows.data, { actorId: args.userId, actorEmail: args.userEmail ?? null });
    if (!visible.ok) return visible;
    const retakes = await readRetakes(db, orgId, args.userId);
    if (!retakes.ok) return retakes;
    const split = splitRetakes(retakes.data, visible.data.rows);
    return ok({
        ...build({
            orgId,
            traineeId: args.userId,
            rows: visible.data.rows,
            retakes: split.shown,
            hiddenRetakes: split.hidden,
            now: args.now ?? Date.now(),
        }),
        generation: await retakeGeneration(db, args.userId, orgId),
    });
}

/** GET /orgs/:orgId/training/pupils/:userId/criterion (the current mentor). */
export async function getPupilCriterion(
    db: Db,
    actor: { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown; now?: number },
): Promise<ServiceResult<TrainingPupilCriterion>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const rows = await loadEvidenceNotes(db, { orgId, traineeId });
    if (!rows.ok) return rows;
    const visible = await visibleEvidence(db, rows.data, actor);
    if (!visible.ok) return visible;
    const retakes = await readRetakes(db, orgId, traineeId);
    if (!retakes.ok) return retakes;
    // A retake was built from specific notes of the person (source_note_ids),
    // not from a matter: the mentor sees its text, topic, status and verdict
    // only when EVERY one of those notes is visible to them today (the same
    // filter as the notes). A retake with any source outside that set, with a
    // source that no longer exists, or with none recorded is only counted:
    // nothing about it is returned (not even the topic label, which the model
    // wrote from notes the mentor cannot read), and it feeds neither the map
    // nor the open retake.
    const openable = splitRetakes(retakes.data, visible.data.rows).shown;
    return ok({
        ...build({ orgId, traineeId, rows: visible.data.rows, retakes: openable, now: actor.now ?? Date.now() }),
        notes_without_access: visible.data.withoutAccess,
        retakes_without_access: retakes.data.length - openable.length,
    });
}
