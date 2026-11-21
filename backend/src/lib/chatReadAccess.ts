// Stored assistant-chat messages are copies of the documents they attach,
// cite, read or create. Whether a person may read a copy is decided when it is
// read, from the documents they can open then (keepReadableDerived).
//
// A chat message records no source column, so its sources are recovered from
// what it stores: the files it attaches, the citations it carries and the
// document events of its answer (read, find, create, edit, replicate),
// delegated events included. A message that names a document it cannot
// identify has unknown provenance and is withheld.
//
// A later answer is written over the whole earlier transcript, so it can
// repeat anything an earlier message drew on: an answer's sources are the
// sources of every message up to it, and unknown provenance taints the rest of
// the chat. What a person typed themselves is not derived from a document and
// is never withheld; only the attachments it names are, one by one.

import { documentIdsInProject, keepReadableDerived, type DerivedReader } from "./access";
import { selectAllByKey, sortRows } from "./batchedQuery";
import type { Db } from "./supabase";
import { isUuid } from "./uuid";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
    Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === "object") : [];

/** One stored reference to a document: its id, or null when it names no usable id. */
const documentIdOf = (value: unknown): string | null =>
    typeof value === "string" && isUuid(value) ? value : null;

const DOCUMENT_EVENTS = new Set(["doc_read", "doc_find", "doc_created", "doc_edited"]);

/**
 * The documents a message itself names: attachments, citations and document
 * events. null when it names a document it gives no usable id for.
 */
export function chatMessageSources(message: Row): readonly string[] | null {
    const ids = new Set<string>();
    let unknown = false;
    const take = (value: unknown) => {
        const id = documentIdOf(value);
        if (id) ids.add(id);
        else unknown = true;
    };
    for (const file of rows(message.files)) take(file.document_id);
    for (const citation of rows(message.citations)) {
        const nested = citation.document as Row | undefined;
        take(citation.document_id ?? nested?.document_id);
    }
    const events = rows(message.content).flatMap((event) =>
        event.type === "delegation" ? [event, ...rows(event.events)] : [event],
    );
    for (const event of events) {
        if (typeof event.type !== "string") continue;
        if (DOCUMENT_EVENTS.has(event.type)) take(event.document_id);
        else if (event.type === "doc_replicated")
            for (const copy of rows(event.copies)) take(copy.document_id);
    }
    return unknown ? null : [...ids];
}

/**
 * For each message, the sources of everything up to and including it in its
 * chat (`messages` are every message of the chats concerned, each chat oldest
 * first): what a message can repeat. null once any of them is unknown.
 */
export function cumulativeChatSources(messages: readonly Row[]): (string[] | null)[] {
    const seen = new Map<unknown, { ids: Set<string>; unknown: boolean }>();
    return messages.map((message) => {
        const own = chatMessageSources(message);
        const chat = seen.get(message.chat_id) ?? { ids: new Set<string>(), unknown: false };
        seen.set(message.chat_id, chat);
        if (own === null) chat.unknown = true;
        else for (const id of own) chat.ids.add(id);
        return chat.unknown ? null : [...chat.ids];
    });
}

type Unit = { sources: readonly string[] | null };

/**
 * The messages the reader may read now. `messages` are every message of the
 * chats concerned, each chat oldest first. A person's own message stays, with
 * the attachments they cannot open removed; any other message (the answers) is
 * kept whole or dropped whole. `withheld` holds the chats with anything
 * removed. One document lookup covers all chats; if it fails this throws.
 */
export async function readableChatMessages<M extends Row>(
    db: Db,
    reader: DerivedReader,
    messages: M[],
): Promise<{ messages: M[]; withheld: Set<string> }> {
    const cumulative = cumulativeChatSources(messages);
    // Per message: the unit of an answer, or the unit of each attachment.
    const unitsOf: Unit[][] = messages.map((message, index) =>
        message.role === "user"
            ? rows(message.files).map((file) => {
                  const id = documentIdOf(file.document_id);
                  return { sources: id ? [id] : null };
              })
            : [{ sources: cumulative[index] }],
    );
    const kept = new Set(
        await keepReadableDerived(db, reader, unitsOf.flat(), (unit) => unit.sources),
    );
    const withheld = new Set<string>();
    const out: M[] = [];
    messages.forEach((message, index) => {
        if (message.role !== "user") {
            if (kept.has(unitsOf[index][0])) out.push(message);
            else withheld.add(message.chat_id as string);
            return;
        }
        const files = rows(message.files);
        const readable = files.filter((_, fileIndex) => kept.has(unitsOf[index][fileIndex]));
        if (readable.length === files.length) out.push(message);
        else {
            out.push({ ...message, files: readable });
            withheld.add(message.chat_id as string);
        }
    });
    return { messages: out, withheld };
}

/**
 * Of `messages` (rows of one chat, by id), those project memory may learn
 * from: project memory is read by the whole project, so every document a
 * message can repeat must be filed in the project, and still readable by the
 * person whose turn it was. The chat's whole history is read, because an
 * answer can repeat what an earlier turn drew on.
 */
export async function filterChatMemoryEvidence<T extends { id: string }>(
    db: Db,
    messages: T[],
    chatId: string,
    reader: DerivedReader,
    projectId: string,
): Promise<T[]> {
    if (!messages.length) return messages;
    const history = sortRows(
        await selectAllByKey<Row>("memory chat provenance", () =>
            db
                .from("chat_messages")
                .select("id, chat_id, role, content, files, citations, created_at")
                .eq("chat_id", chatId),
        ),
        "created_at",
    );
    const cumulative = cumulativeChatSources(history);
    const sourcesById = new Map(history.map((row, index) => [row.id, cumulative[index]]));
    const inProject = await documentIdsInProject(
        db,
        cumulative.flatMap((sources) => sources ?? []),
        projectId,
    );
    return keepReadableDerived(db, reader, messages, (message) => {
        const sources = sourcesById.get(message.id) ?? null;
        return sources && sources.every((id) => inProject.has(id)) ? sources : null;
    });
}
