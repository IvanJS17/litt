// Read access to tabular review content that leaves the tabular module:
// which review rows a caller may read, and which review-chat messages
// (TD-023 source provenance). The account export and the review routes share
// this one copy, so it lives in lib rather than behind the tabular facade
// (whose import of the user facade would close a load-time cycle).
//
// Source provenance for tabular review chat transcripts (TD-023).
//
// A review chat answers over the cells and row labels its author could read
// when the turn ran — text extracted from documents that may live in another
// project. Review access is not document access (see filterReadableReviewRows),
// so a transcript cannot be shared on review access alone: a member who cannot
// read project X, or whose access to X was revoked, must not read X's text
// through a colleague's transcript, an export, or a queued export job.
//
// Every message therefore records `source_document_ids`: the documents whose
// derived text could have reached it. The set is cumulative per chat, because
// each turn replays the earlier transcript to the model, so a later answer can
// repeat anything an earlier turn saw. A reader sees a message only while they
// can read every document in its set. Free text is never inspected or
// rewritten; a message is shown whole or withheld whole.
//
// `null` means unknown provenance (messages written before provenance was
// recorded). Unknown is withheld from every reader and taints the rest of the
// chat, because there is no evidence of what it was derived from.

import { filterAccessibleDocumentIds } from "./access";
import type { Db } from "./supabase";

export type ReviewRow = {
    id: string;
    review_id: string;
    label: string;
    row_type: "document" | "folder";
    folder_id: string | null;
    library_folder_id: string | null;
    document_id: string | null;
    sort_index: number;
    source_document_ids?: string[];
};

/**
 * Narrow a review's rows to those the CALLER may read. Review access is not
 * document access: a review in project Y can be built from project X's
 * documents, and a Y member without X access must not read X's filenames
 * (row labels) or the text extracted from them (cells). A row is visible only
 * when the caller can read every source document feeding it — the same rule
 * generation applies before extracting. Also returns the readable document
 * ids so callers can filter document metadata with the same verdict.
 */
export async function filterReadableReviewRows(
    db: Db,
    rows: ReviewRow[],
    extraDocumentIds: string[],
    userId: string,
    userEmail: string | null | undefined,
): Promise<{ rows: ReviewRow[]; readableDocumentIds: Set<string> }> {
    const ids = [
        ...new Set([
            ...rows.flatMap((row) => row.source_document_ids ?? []),
            ...extraDocumentIds,
        ]),
    ];
    const readableDocumentIds = new Set(
        await filterAccessibleDocumentIds(ids, userId, userEmail, db),
    );
    return {
        rows: rows.filter((row) =>
            (row.source_document_ids ?? []).every((id) =>
                readableDocumentIds.has(id),
            ),
        ),
        readableDocumentIds,
    };
}

export async function loadReviewRows(
    db: Db,
    reviewId: string,
): Promise<ReviewRow[]> {
    const { data, error } = await db
        .from("tabular_review_rows")
        .select("*")
        .eq("review_id", reviewId)
        .order("sort_index", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ReviewRow[];
    if (!rows.length) return rows;
    const { data: sources, error: sourceError } = await db
        .from("tabular_review_row_sources")
        .select("row_id, document_id")
        .in("row_id", rows.map((row) => row.id))
        .order("sort_index", { ascending: true });
    if (sourceError) throw new Error(sourceError.message);
    const byRow = new Map<string, string[]>();
    for (const source of sources ?? []) {
        byRow.set(source.row_id, [
            ...(byRow.get(source.row_id) ?? []),
            source.document_id,
        ]);
    }
    return rows.map((row) => ({
        ...row,
        source_document_ids:
            byRow.get(row.id) ?? (row.document_id ? [row.document_id] : []),
    }));
}


export type ProvenancedMessage = {
    chat_id?: unknown;
    source_document_ids?: unknown;
};

function provenanceOf(message: ProvenancedMessage): string[] | null {
    const ids = message.source_document_ids;
    if (!Array.isArray(ids)) return null;
    return ids.filter((id): id is string => typeof id === "string");
}

const CHAT_MESSAGES_PAGE_SIZE = 1000;

/**
 * Every message of the given chats, oldest first. Provenance decisions are
 * only sound over the complete set — PostgREST silently caps each response
 * (`max_rows`), and a dropped page can hide the one message that carried a
 * document's taint. Pages follow a stable order (created_at, id), and the
 * collected rows are checked against the exact count; a short read throws so
 * callers fail closed instead of deciding on a subset.
 */
export async function selectCompleteChatMessages(
    db: Db,
    chatIds: string[],
    columns: string,
): Promise<Record<string, unknown>[]> {
    if (!chatIds.length) return [];
    const rows: Record<string, unknown>[] = [];
    let expected: number | null = null;
    for (let from = 0; ; from += CHAT_MESSAGES_PAGE_SIZE) {
        const { data, error, count } = await db
            .from("tabular_review_chat_messages")
            .select(columns, { count: "exact" })
            .in("chat_id", chatIds)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + CHAT_MESSAGES_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        if (typeof count !== "number")
            throw new Error("Chat message count unavailable");
        expected ??= count;
        const batch = (data ?? []) as unknown as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < CHAT_MESSAGES_PAGE_SIZE) break;
    }
    // Rows inserted while paging only add to the set; fewer than counted
    // means a page was capped or lost.
    if (rows.length < expected)
        throw new Error("Incomplete chat message read");
    return rows;
}

/**
 * Provenance for the next turn of a chat: the documents behind every earlier
 * message plus the documents this turn hands the model. Returns null when an
 * earlier message has unknown provenance, so the taint is never laundered.
 */
export async function nextTurnSourceDocumentIds(
    db: Db,
    chatId: string,
    turnDocumentIds: string[],
): Promise<string[] | null> {
    const data = await selectCompleteChatMessages(
        db,
        [chatId],
        "id, source_document_ids",
    );
    const ids = new Set(turnDocumentIds);
    for (const message of data as ProvenancedMessage[]) {
        const prior = provenanceOf(message);
        if (prior === null) return null;
        for (const id of prior) ids.add(id);
    }
    return [...ids].sort();
}

/**
 * Keep the messages whose every source document the reader can read now.
 * One access query covers the whole batch; an access read error throws, so a
 * caller fails closed rather than returning an unfiltered transcript.
 */
export async function filterReadableChatMessages<T extends ProvenancedMessage>(
    db: Db,
    messages: T[],
    userId: string,
    userEmail: string | null | undefined,
): Promise<T[]> {
    const known = messages.filter((message) => provenanceOf(message) !== null);
    const ids = [...new Set(known.flatMap((m) => provenanceOf(m) ?? []))];
    const readable = new Set(
        ids.length
            ? await filterAccessibleDocumentIds(ids, userId, userEmail, db)
            : [],
    );
    return known.filter((message) =>
        (provenanceOf(message) ?? []).every((id) => readable.has(id)),
    );
}

/**
 * A chat's title comes from its own turns (generated from the first message
 * or typed by its author), so it carries the chat's provenance: shown only
 * when the reader can read every message of the chat. `allMessages` must be
 * the chat's complete, unfiltered message list.
 */
export function withReadableTitles<
    C extends { id?: unknown; title?: unknown },
>(
    chats: C[],
    allMessages: ProvenancedMessage[],
    readableMessages: ProvenancedMessage[],
): C[] {
    const total = new Map<unknown, number>();
    const readable = new Map<unknown, number>();
    for (const m of allMessages)
        total.set(m.chat_id, (total.get(m.chat_id) ?? 0) + 1);
    for (const m of readableMessages)
        readable.set(m.chat_id, (readable.get(m.chat_id) ?? 0) + 1);
    return chats.map((chat) =>
        (total.get(chat.id) ?? 0) === (readable.get(chat.id) ?? 0)
            ? chat
            : { ...chat, title: null },
    );
}

/**
 * Tabular transcript messages the memory curator may learn from. Their
 * provenance is read here by id, so the caller's row shape is untouched. The
 * actor must still read every source document, and project memory — read by
 * the whole project — learns only from messages derived entirely from
 * documents of that project; text from another project's documents stays out.
 */
export async function filterMemoryEvidenceMessages<T extends { id: string }>(
    db: Db,
    messages: T[],
    actorUserId: string,
    actorEmail: string | null | undefined,
    projectId: string | null,
): Promise<T[]> {
    if (!messages.length) return messages;
    const { data, error } = await db
        .from("tabular_review_chat_messages")
        .select("id, source_document_ids")
        .in(
            "id",
            messages.map((message) => message.id),
        );
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
        id: string;
        source_document_ids: unknown;
    }[];
    const readable = await filterReadableChatMessages(
        db,
        rows,
        actorUserId,
        actorEmail,
    );
    let allowed = readable;
    if (projectId) {
        const ids = [
            ...new Set(readable.flatMap((m) => provenanceOf(m) ?? [])),
        ];
        const { data: docs, error: docsError } = ids.length
            ? await db.from("documents").select("id, project_id").in("id", ids)
            : { data: [], error: null };
        if (docsError) throw new Error(docsError.message);
        const inProject = new Set(
            ((docs ?? []) as { id: string; project_id: string | null }[])
                .filter((doc) => doc.project_id === projectId)
                .map((doc) => doc.id),
        );
        allowed = readable.filter((message) =>
            (provenanceOf(message) ?? []).every((id) => inProject.has(id)),
        );
    }
    const allowedIds = new Set(allowed.map((row) => row.id));
    return messages.filter((message) => allowedIds.has(message.id));
}
