// chat messages — implementation behind the module facade.
// Business logic + data-access for the chat module.
//
// These functions are the service layer behind chat.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, perform the
// chat orchestration / DB work, and RETURN values or typed error results. They
// never touch req/res — the thin route handlers map the results onto HTTP
// status codes, headers, and response bodies.
//
// IMPORTANT: the SSE streaming loop (header flush, runLLMStream, abort
// handling, assistant-message persistence) deliberately stays in the route —
// its ordering is delicate. Only the NON-streaming logic and the pre-stream
// DB preparation live here. `prepareChatStream` returns the prepared data the
// route needs to run the stream; it does not stream.
import { type DerivedReader } from "../../lib/access";
import { selectAllByKey, selectInBatches, sortRows } from "../../lib/batchedQuery";
import { readableChatMessages } from "../../lib/chatReadAccess";
import { readReviewRefs, reviewRefsOf } from "../../lib/citationSupport";
import { type Db } from "../../lib/supabase";
import { withDelegationEvents, withoutEmptyAssistantReservations } from "./engine/index";

// Stored doc_edited events capture the `status` at the time the assistant
// produced the edit (always "pending"). If the user later accepts or rejects,
// `document_edits.status` is updated but the stored event is not. On chat load
// we merge the current DB status in so EditCards render with the real state.
async function hydrateEditStatuses(
    messages: Record<string, unknown>[],
    db: Db,
): Promise<Record<string, unknown>[]> {
    const editIds = new Set<string>();
    const versionIds = new Set<string>();
    const collectFromAnnList = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const a of list as Record<string, unknown>[]) {
            if (typeof a?.edit_id === "string") editIds.add(a.edit_id);
            if (typeof a?.version_id === "string")
                versionIds.add(a.version_id);
        }
    };
    for (const m of messages) {
        const content = m.content;
        if (Array.isArray(content)) {
            for (const ev of withDelegationEvents(content as Record<string, unknown>[])) {
                if (ev?.type === "doc_edited") {
                    collectFromAnnList(ev.annotations);
                    if (typeof ev.version_id === "string")
                        versionIds.add(ev.version_id);
                }
            }
        }
    }
    if (editIds.size === 0 && versionIds.size === 0) return messages;

    // Edit status patch.
    const statusById = new Map<string, "pending" | "accepted" | "rejected">();
    if (editIds.size > 0) {
        const rows = await selectInBatches<{ id: string; status: string }>(
            "edit status lookup",
            editIds,
            (batch) => db.from("document_edits").select("id, status").in("id", batch),
        );
        for (const r of rows) {
            if (
                r.status === "pending" ||
                r.status === "accepted" ||
                r.status === "rejected"
            ) {
                statusById.set(r.id, r.status);
            }
        }
    }

    // Version-number patch — old stored events don't carry `version_number`
    // because they predate the schema change. Look it up from
    // document_versions so the UI can render "V3" chips + download filenames.
    const versionNumberById = new Map<string, number | null>();
    if (versionIds.size > 0) {
        const vrows = await selectInBatches<{ id: string; version_number: number | null }>(
            "edit version lookup",
            versionIds,
            (batch) => db.from("document_versions").select("id, version_number").in("id", batch),
        );
        for (const r of vrows) {
            versionNumberById.set(r.id, r.version_number ?? null);
        }
    }

    const patchAnnList = (list: unknown): unknown => {
        if (!Array.isArray(list)) return list;
        return (list as Record<string, unknown>[]).map((a) => {
            let next = a;
            if (typeof a?.edit_id === "string" && statusById.has(a.edit_id)) {
                next = { ...next, status: statusById.get(a.edit_id) };
            }
            if (
                typeof a?.version_id === "string" &&
                versionNumberById.has(a.version_id)
            ) {
                next = {
                    ...next,
                    version_number: versionNumberById.get(a.version_id) ?? null,
                };
            }
            return next;
        });
    };
    const patchEvent = (ev: Record<string, unknown>): Record<string, unknown> => {
        if (ev?.type === "delegation" && Array.isArray(ev.events)) {
            return {
                ...ev,
                events: (ev.events as Record<string, unknown>[]).map(patchEvent),
            };
        }
        if (ev?.type !== "doc_edited") return ev;
        let patched: Record<string, unknown> = {
            ...ev,
            annotations: patchAnnList(ev.annotations),
        };
        if (
            typeof ev.version_id === "string" &&
            versionNumberById.has(ev.version_id)
        ) {
            patched = {
                ...patched,
                version_number: versionNumberById.get(ev.version_id) ?? null,
            };
        }
        return patched;
    };
    return messages.map((m) => {
        const next: Record<string, unknown> = { ...m };
        if (Array.isArray(m.content)) {
            next.content = (m.content as Record<string, unknown>[]).map(patchEvent);
        }
        return next;
    });
}

// GET /chat/:chatId — the transcript, with the edit statuses hydrated and
// the never-populated assistant reservations dropped.
export async function getChatMessages(
    db: Db,
    chatId: string,
    reader: DerivedReader,
): Promise<Record<string, unknown>[]> {
    const { data: messages } = await db
        .from("chat_messages")
        .select("*")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    // The caller has authorised the chat, not the documents its messages
    // were built from: an answer the reader cannot open now keeps its place,
    // emptied and marked `unreadable` with its reason, so nothing disappears silently. A
    // lookup that fails throws.
    // origin_grant_id links a message to a connection: not for chat readers.
    const stored = withoutEmptyAssistantReservations(messages ?? []).map(
        ({ origin_grant_id: _originGrantId, ...message }) => message,
    );
    const { messages: readable, reasons } = await readableChatMessages(db, reader, stored, "chat_messages", "live");
    const readableById = new Map(readable.map((m) => [m.id, m]));
    const visible = stored.map(
        (m) =>
            readableById.get(m.id) ?? {
                ...m,
                content: [],
                files: null,
                citations: null,
                unreadable: true,
                unreadable_reason: reasons.get(String(m.id)) ?? "no_access",
            },
    );
    // The low-band citation refs of the answers ride along.
    const reviewRefs = await readReviewRefs(
        db,
        "chat",
        visible.flatMap((m) =>
            m.role === "assistant" && typeof m.id === "string" ? [m.id] : [],
        ),
    );
    const hydrated = await hydrateEditStatuses(visible, db);
    return hydrated.map((m) =>
        reviewRefs.has(m.id as string)
            ? { ...m, review_refs: reviewRefsOf(reviewRefs, m.id) }
            : m,
    );
}

/**
 * What a reader judging many chats at once needs of their messages (the
 * content, files and citations that name documents): every message of the
 * given chats, complete past the gateway's row limit and read in batches
 * of chats, oldest first. No hydration, and no read of the chats' access: the
 * caller has authorised them.
 */
export async function getMessagesOfChats(
    db: Db,
    chatIds: string[],
): Promise<Record<string, unknown>[]> {
    const rows = await selectInBatches<Record<string, unknown>>(
        "chat messages",
        chatIds,
        (batch) =>
            selectAllByKey<Record<string, unknown>>("chat messages", () =>
                db
                    .from("chat_messages")
                    .select("id, chat_id, role, content, files, citations, created_at")
                    .in("chat_id", batch),
            ),
    );
    return sortRows(rows, "created_at");
}

/**
 * What a reader judging the files attached to the people's messages of many
 * chats needs: the person's messages that attach files, with the files and
 * nothing else (no text), complete past the gateway's row limit and read in
 * batches of chats, oldest first. A failed read throws. As `getMessagesOfChats`,
 * the caller has authorised the chats.
 */
export async function getAttachmentsOfChats(
    db: Db,
    chatIds: string[],
): Promise<Record<string, unknown>[]> {
    const rows = await selectInBatches<Record<string, unknown>>(
        "chat attachments",
        chatIds,
        (batch) =>
            selectAllByKey<Record<string, unknown>>("chat attachments", () =>
                db
                    .from("chat_messages")
                    .select("id, chat_id, role, files, created_at")
                    .eq("role", "user")
                    .not("files", "is", null)
                    .in("chat_id", batch),
            ),
    );
    return sortRows(rows, "created_at");
}
