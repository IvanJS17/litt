// LiTT training layer 3 «Modo de rendir cuentas» (docs/training.md): reading
// and marking the backing checks of a junior's answers.
//
// The checks are written by lib/trainingTurn/accountability.ts after each
// turn. This module shows them: to the person (their own, and what they did
// with each conclusion) and to their CURRENT mentor (for works in matters the
// mentor can open; the others are only counted). They are learning data, so
// every read goes through assertLearningAccess: nobody else gets one, not an
// owner or an admin, and any other case is the same 404. The status of a
// conclusion is the server's: it is recomputed here from the citations
// persisted with the message, so a conclusion is `backed` only while its exact
// passage can be shown.

import type {
    TrainingBackingCheck,
    TrainingBackingConclusion,
    TrainingBackingMark,
    TrainingChatBacking,
    TrainingPupilBacking,
} from "@mike/contracts";
import { recordAudit } from "../../lib/audit";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    BACKING_CHAT_COLUMN,
    BACKING_MESSAGES,
    BACKING_NOTE_MAX_CHARS,
    effectiveBackingStatus,
    passageFor,
    readBackingCitations,
    unverifiedReferences,
    type BackingCitation,
    type BackingSurface,
    type StoredConclusion,
} from "../../lib/trainingTurn/accountability";
import { mayOpenWorkMatter, workPlace } from "../../lib/trainingWork";
import { isUuid } from "../../lib/uuid";
import { assertCurrentMentor, assertLearningAccess, LEARNING_NOT_FOUND } from "../training-supervision/trainingSupervision.service";

export const BACKING_INVALID_CODE = "training_backing_invalid";
const SURFACES = Object.keys(BACKING_CHAT_COLUMN) as BackingSurface[];
const IN_CHUNK = 100;

type CheckRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
    message_id: string;
    status: string;
    conclusions: unknown;
    created_at: string;
    updated_at: string;
};

const notFound = () => failure("not_found", LEARNING_NOT_FOUND);

function surfaceOf(row: CheckRow): { surface: BackingSurface; chatId: string } | null {
    for (const surface of SURFACES) {
        const id = row[BACKING_CHAT_COLUMN[surface]];
        if (id) return { surface, chatId: id };
    }
    return null;
}

function storedConclusions(value: unknown): StoredConclusion[] {
    return Array.isArray(value) ? (value as StoredConclusion[]).filter((item) => item && typeof item.id === "string") : [];
}

/** The persisted citations of each message, per surface. */
async function loadCitations(db: Db, rows: readonly CheckRow[]): Promise<ServiceResult<Map<string, BackingCitation[]>>> {
    const bySurface = new Map<BackingSurface, string[]>();
    for (const row of rows) {
        const at = surfaceOf(row);
        if (at) bySurface.set(at.surface, [...(bySurface.get(at.surface) ?? []), row.message_id]);
    }
    const citations = new Map<string, BackingCitation[]>();
    for (const [surface, ids] of bySurface) {
        const spec = BACKING_MESSAGES[surface];
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
            const { data, error } = await db
                .from(spec.table)
                .select(`id, ${spec.citations}`)
                .in("id", ids.slice(i, i + IN_CHUNK));
            if (error) return internalFailure(error);
            for (const message of (data ?? []) as unknown as Record<string, unknown>[])
                citations.set(String(message.id), readBackingCitations(message[spec.citations]));
        }
    }
    return ok(citations);
}

/** One row as the person or the mentor sees it. Only a passage that can be shown makes a conclusion backed. */
function present(row: CheckRow, citations: readonly BackingCitation[], now: number): TrainingBackingCheck | null {
    const at = surfaceOf(row);
    if (!at) return null;
    const status = effectiveBackingStatus(row.status, row.created_at, now);
    const conclusions: TrainingBackingConclusion[] | null =
        status === "ready"
            ? storedConclusions(row.conclusions).map((stored) => {
                  const passage = passageFor(stored, citations);
                  const citation = citations.find((entry) => entry.ref === stored.citation_ref);
                  // Read again with the passage as it is now: a conclusion is backed only while the
                  // passage shows every reference it names (same law, same number).
                  const unverified = unverifiedReferences(
                      stored.text,
                      passage ? (citation?.excerpt ?? null) : null,
                      citation?.title ?? null,
                  );
                  const lost = stored.status === "backed" && (!passage || unverified.length > 0);
                  return {
                      id: stored.id,
                      text: stored.text,
                      citation_ref: lost ? null : stored.citation_ref,
                      status: lost ? "unbacked" : stored.status,
                      passage: lost ? null : passage,
                      unverified_references: stored.status === "backed" ? unverified : (stored.unverified_references ?? []),
                      person_verified: stored.person_verified === true,
                      person_note: stored.person_note ?? null,
                  };
              })
            : null;
    return {
        id: row.id,
        org_id: row.org_id,
        trainee_user_id: row.trainee_user_id,
        chat_id: at.chatId,
        message_id: row.message_id,
        status,
        conclusions,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

async function presentAll(db: Db, rows: readonly CheckRow[]): Promise<ServiceResult<TrainingBackingCheck[]>> {
    const loaded = await loadCitations(db, rows);
    if (!loaded.ok) return loaded;
    const now = Date.now();
    return ok(
        rows
            .map((row) => present(row, loaded.data.get(row.message_id) ?? [], now))
            .filter((check): check is TrainingBackingCheck => check !== null),
    );
}

/** The person's own checks of one chat (any surface); a chat with none of theirs is a 404, as it is for anybody else. */
export async function getMyChatBacking(
    db: Db,
    args: { userId: string; chatId: string; messageId?: string | null },
): Promise<ServiceResult<TrainingChatBacking>> {
    if (!isUuid(args.chatId) || (args.messageId != null && !isUuid(args.messageId))) return notFound();
    const rows: CheckRow[] = [];
    for (const column of Object.values(BACKING_CHAT_COLUMN)) {
        let query = db
            .from("training_backing_checks")
            .select("*")
            .eq(column, args.chatId)
            .eq("trainee_user_id", args.userId);
        if (args.messageId) query = query.eq("message_id", args.messageId);
        const { data, error } = await query;
        if (error) return internalFailure(error);
        rows.push(...((data ?? []) as unknown as CheckRow[]));
    }
    // Nothing of theirs here: the same 404 as for somebody else's chat.
    if (rows.length === 0) return notFound();
    for (const orgId of new Set(rows.map((row) => row.org_id))) {
        const access = await assertLearningAccess(db, { actorId: args.userId, orgId, traineeId: args.userId });
        if (!access.ok) return access;
    }
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const checks = await presentAll(db, rows);
    return checks.ok ? ok({ checks: checks.data }) : checks;
}

function readMark(body: unknown): { verified?: boolean; note?: string | null } | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const { person_verified: verified, person_note: note, ...rest } = body as TrainingBackingMark & Record<string, unknown>;
    if (Object.keys(rest).length > 0 || (verified === undefined && note === undefined)) return null;
    if (verified !== undefined && typeof verified !== "boolean") return null;
    if (note !== undefined && note !== null && typeof note !== "string") return null;
    const trimmed = typeof note === "string" ? note.trim() : note;
    if (typeof trimmed === "string" && [...trimmed].length > BACKING_NOTE_MAX_CHARS) return null;
    return {
        ...(verified !== undefined ? { verified } : {}),
        ...(note !== undefined ? { note: trimmed ? trimmed : null } : {}),
    };
}

/**
 * The person marks «lo verifiqué» on a conclusion, or writes why they keep it.
 * Only their own, ready check; a lost race with a second tab is a 409.
 */
export async function markMyConclusion(
    db: Db,
    args: {
        userId: string;
        userEmail?: string | null;
        chatId: string;
        checkId: string;
        conclusionId: string;
        body: unknown;
    },
): Promise<ServiceResult<TrainingBackingCheck>> {
    if (!isUuid(args.chatId) || !isUuid(args.checkId) || typeof args.conclusionId !== "string") return notFound();
    const mark = readMark(args.body);
    if (!mark) return failure("validation", "Invalid backing mark", BACKING_INVALID_CODE);
    const { data, error } = await db
        .from("training_backing_checks")
        .select("*")
        .eq("id", args.checkId)
        .eq("trainee_user_id", args.userId)
        .maybeSingle();
    if (error) return internalFailure(error);
    const row = data as unknown as CheckRow | null;
    const at = row ? surfaceOf(row) : null;
    if (!row || !at || at.chatId !== args.chatId) return notFound();
    const access = await assertLearningAccess(db, { actorId: args.userId, orgId: row.org_id, traineeId: args.userId });
    if (!access.ok) return access;
    if (effectiveBackingStatus(row.status, row.created_at) !== "ready") return failure("conflict", "Backing check is not ready");

    const stored = storedConclusions(row.conclusions);
    const target = stored.find((item) => item.id === args.conclusionId);
    if (!target) return notFound();
    const next = stored.map((item) =>
        item.id === target.id
            ? {
                  ...item,
                  ...(mark.verified !== undefined ? { person_verified: mark.verified } : {}),
                  ...(mark.note !== undefined ? { person_note: mark.note } : {}),
              }
            : item,
    );
    const updatedAt = new Date().toISOString();
    const saved = await db
        .from("training_backing_checks")
        .update({ conclusions: next, updated_at: updatedAt })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("*");
    if (saved.error) return internalFailure(saved.error);
    const written = ((saved.data ?? []) as unknown as CheckRow[])[0];
    if (!written) return failure("conflict", "Backing check changed; reload it");

    // Ids only: what the person wrote, and the conclusion, stay in the row.
    if (mark.verified === true && target.person_verified !== true) {
        await recordAudit(db, {
            userId: args.userId,
            userEmail: args.userEmail ?? null,
            orgId: row.org_id,
            action: "training.backing_verified",
            surface: "organization",
            chatId: args.chatId,
            detail: { org_id: row.org_id, target_user_id: args.userId },
        });
    }
    const presented = await presentAll(db, [written]);
    if (!presented.ok) return presented;
    return presented.data[0] ? ok(presented.data[0]) : notFound();
}

/**
 * What a pupil's current mentor sees: the ready checks of the works in
 * matters the mentor can open, newest work first (never by performance). The
 * works in other matters are only counted.
 */
export async function getPupilBacking(
    db: Db,
    actor: { actorId: string; actorEmail: string | null; orgId: unknown; traineeId: unknown },
): Promise<ServiceResult<TrainingPupilBacking>> {
    const gate = await assertCurrentMentor(db, actor);
    if (!gate.ok) return gate;
    const { orgId, traineeId } = gate.data;
    const { data, error } = await db
        .from("training_backing_checks")
        .select("*")
        .eq("org_id", orgId)
        .eq("trainee_user_id", traineeId)
        .eq("status", "ready");
    if (error) return internalFailure(error);
    const rows = (data ?? []) as unknown as CheckRow[];

    const works = new Map<string, { surface: BackingSurface; chatId: string; rows: CheckRow[] }>();
    for (const row of rows) {
        const at = surfaceOf(row);
        if (!at) continue;
        const key = `${at.surface}:${at.chatId}`;
        works.set(key, { ...at, rows: [...(works.get(key)?.rows ?? []), row] });
    }
    const visible: { surface: BackingSurface; chatId: string; projectId: string | null; title: string | null; rows: CheckRow[] }[] = [];
    let hidden = 0;
    for (const work of works.values()) {
        const place = await workPlace(db, work.surface, work.chatId);
        if (!place.ok) return internalFailure(place.error);
        if (
            !place.place ||
            !(await mayOpenWorkMatter(db, { projectId: place.place.projectId, actorId: actor.actorId, actorEmail: actor.actorEmail }))
        ) {
            hidden += 1;
            continue;
        }
        visible.push({ ...work, projectId: place.place.projectId, title: place.place.title });
    }
    const presented = await presentAll(db, visible.flatMap((work) => work.rows));
    if (!presented.ok) return presented;
    const byId = new Map(presented.data.map((check) => [check.id, check]));
    const result = visible
        .map((work) => ({
            surface: work.surface,
            chat_id: work.chatId,
            project_id: work.projectId,
            title: work.title,
            checks: work.rows
                .map((row) => byId.get(row.id))
                .filter((check): check is TrainingBackingCheck => !!check && (check.conclusions?.length ?? 0) > 0)
                .sort((a, b) => a.created_at.localeCompare(b.created_at)),
        }))
        .filter((work) => work.checks.length > 0)
        .sort((a, b) =>
            b.checks[b.checks.length - 1].created_at.localeCompare(a.checks[a.checks.length - 1].created_at),
        );
    return ok({ org_id: orgId, trainee_user_id: traineeId, works: result, works_without_access: hidden });
}
