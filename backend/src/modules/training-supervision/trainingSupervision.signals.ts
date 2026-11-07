// What a two-minute review rests on, computed without any model
// (docs/training.md, layer 2): the pupil's turn notes grouped into works, and
// for one work its counted signals, «qué propuso» (the attempts as written)
// and «qué quedó sin verificar» (citations not verified, the pupil's sealed
// drafts still without an approval, and what the contrasts marked «Faltó»).
// No transcript and no document text is read beyond those fields.

import type { TrainingReviewItem, TrainingWorkSignals } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    contrastSections,
    TURN_NOTE_CHAT_COLUMN,
    type TurnNoteSurface,
} from "../../lib/trainingNotes";
import { heldVersionIds, type SealStage } from "../../lib/trainingRelease";
import { REVIEW_MAX_NOTES } from "../../lib/trainingSupervisionAi";
import { WORK_SURFACES } from "../../lib/trainingWork";

export type NoteRow = {
    id: string;
    org_id: string;
    trainee_user_id: string;
    chat_id: string | null;
    word_chat_id: string | null;
    tabular_chat_id: string | null;
    message_id: string;
    attempt: string;
    contrast: string | null;
    contrast_status: string;
    created_at: string;
};

export type Work = {
    surface: TurnNoteSurface;
    chatId: string;
    /** Oldest first. */
    notes: NoteRow[];
};

const NOTE_COLUMNS =
    "id, org_id, trainee_user_id, chat_id, word_chat_id, tabular_chat_id, message_id, attempt, contrast, contrast_status, created_at";

/** The pupil's turn notes in one organization; with `work`, only that chat's. */
export async function loadTraineeNotes(
    db: Db,
    args: { orgId: string; traineeId: string; work?: { surface: TurnNoteSurface; chatId: string } },
): Promise<ServiceResult<NoteRow[]>> {
    let query = db
        .from("training_turn_notes")
        .select(NOTE_COLUMNS)
        .eq("org_id", args.orgId)
        .eq("trainee_user_id", args.traineeId);
    if (args.work) query = query.eq(TURN_NOTE_CHAT_COLUMN[args.work.surface], args.work.chatId);
    const { data, error } = await query;
    if (error) return internalFailure(error);
    return ok((data ?? []) as unknown as NoteRow[]);
}

export function surfaceOf(row: {
    chat_id?: string | null;
    word_chat_id?: string | null;
    tabular_chat_id?: string | null;
}): { surface: TurnNoteSurface; chatId: string } | null {
    for (const surface of WORK_SURFACES) {
        const id = row[TURN_NOTE_CHAT_COLUMN[surface] as "chat_id"];
        if (id) return { surface, chatId: id };
    }
    return null;
}

/** One work per chat, newest activity first (never ordered by performance). */
export function groupWorks(notes: readonly NoteRow[]): Work[] {
    const works = new Map<string, Work>();
    for (const note of notes) {
        const at = surfaceOf(note);
        if (!at) continue;
        const key = `${at.surface}:${at.chatId}`;
        const work = works.get(key) ?? { ...at, notes: [] };
        work.notes.push(note);
        works.set(key, work);
    }
    for (const work of works.values())
        work.notes.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return [...works.values()].sort((a, b) =>
        b.notes[b.notes.length - 1].created_at.localeCompare(a.notes[a.notes.length - 1].created_at),
    );
}

const MESSAGES: Record<TurnNoteSurface, { table: string; columns: string; citations: string }> = {
    chat: { table: "chat_messages", columns: "id, role, content, citations", citations: "citations" },
    word: { table: "word_chat_messages", columns: "id, role, citations", citations: "citations" },
    tabular: {
        table: "tabular_review_chat_messages",
        columns: "id, role, annotations",
        citations: "annotations",
    },
};

const IN_CHUNK = 100;
const PROPOSED_MAX_CHARS = 600;
const LINE_MAX_CHARS = 400;
// Keeps each list inside the column's 20000-byte check, accents included.
const UNVERIFIED_MAX = 20;

const clip = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Rows whose `column` is one of `ids`, read in chunks. */
export async function selectIn<T>(
    db: Db,
    table: string,
    columns: string,
    column: string,
    ids: readonly string[],
): Promise<ServiceResult<T[]>> {
    const rows: T[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await db.from(table).select(columns).in(column, ids.slice(i, i + IN_CHUNK));
        if (error) return internalFailure(error);
        rows.push(...((data ?? []) as unknown as T[]));
    }
    return ok(rows);
}

type Citation = {
    verified?: unknown;
    quote?: unknown;
    filename?: unknown;
    doc_name?: unknown;
    col_name?: unknown;
};

/** The version ids an assistant message's events produced. */
function eventVersionIds(content: unknown): string[] {
    const ids: string[] = [];
    const walk = (events: unknown) => {
        if (!Array.isArray(events)) return;
        for (const event of events as Record<string, unknown>[]) {
            if (!event || typeof event !== "object") continue;
            if (typeof event.version_id === "string") ids.push(event.version_id);
            if (Array.isArray(event.copies))
                for (const copy of event.copies as Record<string, unknown>[])
                    if (copy && typeof copy.version_id === "string") ids.push(copy.version_id);
            // A delegation's own events are the turn's too.
            walk(event.events);
        }
    };
    walk(content);
    return ids;
}

export type WorkSignals = {
    signals: TrainingWorkSignals;
    proposed: TrainingReviewItem[];
    unverified: TrainingReviewItem[];
};

/** The pure part: the review's computed lines from what was read. */
export function computeWorkLines(args: {
    notes: readonly NoteRow[];
    citations: { messageId: string; citation: Citation }[];
    heldVersions: { id: string; filename: string | null }[];
}): Pick<WorkSignals, "proposed" | "unverified"> & { citationsUnverified: number } {
    const proposed = args.notes.slice(-REVIEW_MAX_NOTES).map((note) => ({
        source: "attempt",
        text: clip(note.attempt.trim(), PROPOSED_MAX_CHARS),
        ref: note.id,
    }));

    const unverified: TrainingReviewItem[] = [];
    const seen = new Set<string>();
    const add = (item: TrainingReviewItem) => {
        const key = `${item.source}:${item.text}`;
        if (seen.has(key) || unverified.length >= UNVERIFIED_MAX) return;
        seen.add(key);
        unverified.push(item);
    };
    // A citation counts as verified only when the server verified it; one
    // that was never checked (tabular cells, older turns) is unverified.
    let citationsUnverified = 0;
    for (const { messageId, citation } of args.citations) {
        if (citation.verified === true) continue;
        citationsUnverified += 1;
        const where = [citation.filename, citation.doc_name, citation.col_name]
            .filter((part): part is string => typeof part === "string" && !!part)
            .join(" · ");
        const quote = typeof citation.quote === "string" ? citation.quote.trim() : "";
        add({
            source: "citation",
            text: clip(`Cita sin verificar${where ? ` (${where})` : ""}${quote ? `: «${quote}»` : ""}`, LINE_MAX_CHARS),
            ref: messageId,
        });
    }
    for (const version of args.heldVersions) {
        add({
            source: "version",
            text: clip(`Borrador de pasante sin aprobar${version.filename ? `: ${version.filename}` : ""}`, LINE_MAX_CHARS),
            ref: version.id,
        });
    }
    for (const note of args.notes) {
        if (note.contrast_status !== "ready" || !note.contrast) continue;
        for (const line of contrastSections(note.contrast).falto)
            add({ source: "contrast", text: clip(`Faltó: ${line}`, LINE_MAX_CHARS), ref: note.id });
    }
    return { proposed, unverified, citationsUnverified };
}

/** Reads what one work's review needs and computes its signals and lines. */
export async function loadWorkSignals(
    db: Db,
    work: Work,
    traineeId: string,
): Promise<ServiceResult<WorkSignals>> {
    const spec = MESSAGES[work.surface];
    const messages = await db.from(spec.table).select(spec.columns).eq("chat_id", work.chatId);
    if (messages.error) return internalFailure(messages.error);
    const rows = (messages.data ?? []) as unknown as Record<string, unknown>[];

    const citations: { messageId: string; citation: Citation }[] = [];
    const versionIds = new Set<string>();
    for (const row of rows) {
        if (row.role !== "assistant") continue;
        const list = row[spec.citations];
        if (Array.isArray(list))
            for (const citation of list)
                if (citation && typeof citation === "object")
                    citations.push({ messageId: String(row.id), citation: citation as Citation });
        for (const id of eventVersionIds(row.content)) versionIds.add(id);
    }

    const edits = await selectIn<{ version_id: string; status: string }>(
        db,
        "document_edits",
        "version_id, status",
        "chat_message_id",
        rows.map((row) => String(row.id)),
    );
    if (!edits.ok) return edits;
    for (const edit of edits.data) versionIds.add(edit.version_id);

    const versions = await selectIn<{
        id: string;
        filename: string | null;
        training_stage: SealStage;
        training_author_user_id: string | null;
        content_sha256: string | null;
        deleted_at: string | null;
    }>(
        db,
        "document_versions",
        "id, filename, training_stage, training_author_user_id, content_sha256, deleted_at",
        "id",
        [...versionIds],
    );
    if (!versions.ok) return versions;
    const own = versions.data.filter(
        (version) => !version.deleted_at && version.training_author_user_id === traineeId,
    );
    const held = await heldVersionIds(db, own);
    if (!held.ok) return held;

    const lines = computeWorkLines({
        notes: work.notes,
        citations,
        heldVersions: own.filter((version) => held.data.has(version.id)),
    });
    const count = (status: string) => edits.data.filter((edit) => edit.status === status).length;
    return ok({
        proposed: lines.proposed,
        unverified: lines.unverified,
        signals: {
            notes: work.notes.length,
            contrasts_ready: work.notes.filter((note) => note.contrast_status === "ready").length,
            citations: citations.length,
            citations_unverified: lines.citationsUnverified,
            edits_accepted: count("accepted"),
            edits_rejected: count("rejected"),
            edits_pending: count("pending"),
            held_versions: held.data.size,
        },
    });
}
