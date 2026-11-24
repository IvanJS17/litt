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
// The assistant's searches name the documents they returned (`document_ids` on
// the event). A search stored before that was recorded names none: what it
// says of itself decides (see `searchWithoutIds`). A workflow's own files are
// stored documents filed under the workflow, so a read or a citation of one is
// judged by the same rule that lets a person open the workflow's documents
// (ensureDocAccess: the workflow's access); a reference that leads to no
// workflow file is unknown.
//
// A later answer is written over the whole earlier transcript, so it can
// repeat anything an earlier message drew on: an answer's sources are the
// sources of every message up to it, and unknown provenance taints the rest of
// the chat. What a person typed themselves is not derived from a document and
// is never withheld; only the attachments it names are, one by one.
//
// A transcript read now (the "live" gate) is stated with the reason of each
// answer it withholds. An answer is withheld for lost access when it names a
// document that still exists and the reader cannot open; that holds for every
// later answer too. For the owner of the chat, whose own history it is, an
// answer whose source cannot be established, or whose document no longer
// exists, is withheld on its own and does not hold the later ones back.

import { documentIdsInProject, filterAccessibleDocumentIds, keepReadableDerived, type DerivedReader } from "./access";
import { selectAllByKey, selectInBatches, sortRows } from "./batchedQuery";
import { withReadableTitles } from "./tabularReadAccess";
import type { Db } from "./supabase";
import { isUuid } from "./uuid";

type Row = Record<string, unknown>;

const rows = (value: unknown): Row[] =>
    Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === "object") : [];

/** One stored reference to a document: its id, or null when it names no usable id. */
const documentIdOf = (value: unknown): string | null =>
    typeof value === "string" && isUuid(value) ? value : null;

const DOCUMENT_EVENTS = new Set(["doc_read", "doc_find", "doc_created", "doc_edited"]);

/** One document version a stored message names: as much of its identity as the message kept. */
export type ChatSourceRef = { documentId: string; versionId: string | null; versionNumber: number | null };

const refKey = (ref: ChatSourceRef) => `${ref.documentId}|${ref.versionId ?? ""}|${ref.versionNumber ?? ""}`;

/**
 * How a reader of derived copies judges what a message names: "export" for
 * the holder's own data, "live" for a transcript read on screen or through a
 * connected app, "memory" for project memory. Without one, a message is read
 * strictly, as it names documents and nothing else: a search stored without
 * its documents that returned results is unknown provenance.
 */
type Gate = "export" | "memory" | "live";

const WORKFLOW_ASSET_ID = /^workflow-asset-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+$/i;
const WORKFLOW = "workflow:";

/** A search stored without its documents: does it name something, and where from? */
function searchWithoutIds(event: Row, gate: Gate | undefined): boolean {
    // Stated limit of the live read: a search stored before searches recorded
    // their documents (it has no document list at all) does not withhold by
    // itself. Searches stored since name their documents and are judged by
    // them; a list that is present but is not one is an unknown source.
    if (gate === "live" && !("document_ids" in event)) return false;
    // Nothing came back, or the search failed: nothing was copied.
    if (event.match_count === 0 || typeof event.error_code === "string" || typeof event.error === "string") return false;
    // Stated limit of the account export: an old search of the project or of one
    // document does not withhold the answer. Neither is judged anywhere else (a
    // document moved or deleted since is not, and a document search may name a
    // document the chat never named); withholding them would take out of every
    // export the answers of anyone who used search in a matter before the
    // documents were recorded. Any other old search that returned results, and
    // every one read for project memory or without a gate, is unknown provenance.
    return gate !== "export" || (event.scope !== "project" && event.scope !== "document");
}

function scan(message: Row, gate?: Gate) {
    const refs = new Map<string, ChatSourceRef>();
    const workflows = new Set<string>();
    let unknown = false;
    const take = (value: unknown, version: Row = {}) => {
        const documentId = documentIdOf(value);
        if (documentId) {
            const ref = {
                documentId,
                versionId: documentIdOf(version.version_id),
                versionNumber: typeof version.version_number === "number" ? version.version_number : null,
            };
            refs.set(refKey(ref), ref);
            return;
        }
        const asset = gate && typeof value === "string" ? WORKFLOW_ASSET_ID.exec(value) : null;
        if (asset) workflows.add(asset[1].toLowerCase());
        else unknown = true;
    };
    // The assistant takes nothing from an attachment that names no document.
    for (const file of rows(message.files)) if (!gate || file.document_id) take(file.document_id, file);
    for (const citation of rows(message.citations)) {
        const nested = citation.document as Row | undefined;
        take(citation.document_id ?? nested?.document_id, citation.version_id || citation.version_number ? citation : nested);
    }
    const events = rows(message.content).flatMap((event) =>
        event.type === "delegation" ? [event, ...rows(event.events)] : [event],
    );
    const applied = events.flatMap((event) =>
        event.type === "workflow_applied" && typeof event.workflow_id === "string" && isUuid(event.workflow_id)
            ? [event.workflow_id.toLowerCase()]
            : [],
    );
    for (const event of events) {
        if (typeof event.type !== "string") continue;
        if (gate && (event.type === "doc_read" || event.type === "doc_find") && !event.document_id && applied.length) {
            // A workflow's file read before its document was recorded: one of the workflows this answer applied.
            for (const id of applied) workflows.add(id);
        } else if (DOCUMENT_EVENTS.has(event.type)) take(event.document_id, event);
        else if (event.type === "doc_replicated")
            for (const copy of rows(event.copies)) take(copy.document_id, copy);
        else if (event.type === "doc_search") {
            if (Array.isArray(event.document_ids)) for (const id of event.document_ids) take(id);
            else if (searchWithoutIds(event, gate)) unknown = true;
        }
    }
    return { refs, workflows, unknown };
}

/** The sources the gate judges: document ids, and `workflow:<id>` for the files of a workflow. */
function gateSources(message: Row, gate: Gate): readonly string[] | null {
    const { refs, workflows, unknown } = scan(message, gate);
    if (unknown) return null;
    return [...new Set([...refs.values()].map((ref) => ref.documentId)), ...[...workflows].map((id) => WORKFLOW + id)];
}

/** Of `documentIds`, the stored files of a workflow. */
async function filesOfWorkflows(db: Db, documentIds: readonly string[]): Promise<Set<string>> {
    type FileRow = { id: string; workflow_id: string | null };
    const found = await selectInBatches<FileRow>("workflow file lookup", documentIds, (batch) =>
        db.from("documents").select("id, workflow_id").in("id", batch),
    );
    return new Set(found.filter((row) => row.workflow_id).map((row) => row.id));
}

/**
 * Replace each `workflow:<id>` by one stored file of that workflow: every file
 * of a workflow is judged by the workflow's access, so one stands for all. A
 * list naming a workflow with no file left is unknown (null).
 */
async function withWorkflowFiles(db: Db, lists: readonly (readonly string[] | null)[]): Promise<(string[] | null)[]> {
    const wanted = lists.flatMap((list) => (list ?? []).filter((id) => id.startsWith(WORKFLOW)).map((id) => id.slice(WORKFLOW.length)));
    const fileOf = new Map<string, string>();
    if (wanted.length) {
        type FileRow = { id: string; workflow_id: string };
        const found = await selectInBatches<FileRow>("workflow file lookup", wanted, (batch) =>
            selectAllByKey<FileRow>("workflow file lookup", () =>
                db.from("documents").select("id, workflow_id").in("workflow_id", batch),
            ),
        );
        for (const file of found) if (!fileOf.has(file.workflow_id)) fileOf.set(file.workflow_id, file.id);
    }
    return lists.map((list) => {
        if (!list) return null;
        const out: string[] = [];
        for (const id of list) {
            const file = id.startsWith(WORKFLOW) ? fileOf.get(id.slice(WORKFLOW.length)) : id;
            if (!file) return null;
            out.push(file);
        }
        return out;
    });
}

/** What each message can repeat: `own(message)` of everything up to it in its chat; null once any is unknown. */
function cumulative<T>(messages: readonly Row[], own: (message: Row) => readonly T[] | null, keyOf: (item: T) => string): (T[] | null)[] {
    const seen = new Map<unknown, { items: Map<string, T>; unknown: boolean }>();
    return messages.map((message) => {
        const items = own(message);
        const chat = seen.get(message.chat_id) ?? { items: new Map<string, T>(), unknown: false };
        seen.set(message.chat_id, chat);
        if (items === null) chat.unknown = true;
        else for (const item of items) chat.items.set(keyOf(item), item);
        return chat.unknown ? null : [...chat.items.values()];
    });
}

/**
 * For each message, the document versions named by everything up to and
 * including it in its chat (`messages` are every message of the chats
 * concerned, each chat oldest first): what a message can repeat. null once any
 * of them is unknown. Serves a caller that needs the version a source names
 * and judges provenance strictly: no gate, so a search stored without its
 * documents that had results, and a workflow's file, are unknown.
 */
export const cumulativeChatSourceRefs = (messages: readonly Row[]): (ChatSourceRef[] | null)[] =>
    cumulative(
        messages,
        (message) => {
            const { refs, unknown } = scan(message);
            return unknown ? null : [...refs.values()];
        },
        refKey,
    );

/** What each message can repeat, as the gate judges it (see `gateSources`). */
const cumulativeSources = (messages: readonly Row[], gate: Gate): (string[] | null)[] =>
    cumulative(messages, (message) => gateSources(message, gate), (id) => id);

/**
 * Of `rows` (stored answers, in any chats), those whose OWN sources the reader
 * can open now, judged as a transcript they read is ("live") and with no regard
 * for any other message. A failed lookup throws.
 */
export async function readableByOwnSources<M extends Row>(db: Db, reader: DerivedReader, rows: M[]): Promise<Set<M>> {
    const resolved = await withWorkflowFiles(db, rows.map((row) => gateSources(row, "live")));
    const resolvedOf = new Map(rows.map((row, index) => [row, resolved[index]]));
    return new Set(await keepReadableDerived(db, reader, rows, (row) => resolvedOf.get(row) ?? null));
}

type Unit = { sources: readonly string[] | null };

/** Why a transcript withholds an answer: access lost to a document that exists, or a source that cannot be established or no longer exists. */
export type WithheldReason = "no_access" | "source_unknown";

/**
 * Of `messages` (the live read), the reason of each answer to withhold, by the
 * rule in the header: `owned` holds the chats the reader owns. Only called
 * when the plain cumulative judgement withheld something. It counts the
 * attachments of the person's messages as that judgement does: a document that
 * exists and that the reader cannot open is a loss of access from that
 * message on, for every reader.
 */
async function liveReasons(db: Db, reader: DerivedReader, messages: readonly Row[]): Promise<Map<string, WithheldReason | null>> {
    const chatIds = [...new Set(messages.map((message) => message.chat_id).filter((id): id is string => typeof id === "string"))];
    const owners = await selectInBatches<{ id: string; user_id: string }>("chat owner lookup", chatIds, (batch) =>
        db.from("chats").select("id, user_id").in("id", batch),
    );
    const owned = new Set(owners.filter((chat) => chat.user_id === reader.userId).map((chat) => chat.id));

    // Everything a message names, whether or not it also names something unknown.
    // A person's own message names its attachments only; one that cannot be
    // identified holds the later answers back from a reader who is not the owner.
    const named = messages.map((message) => {
        const { refs, workflows, unknown } = scan(message, "live");
        return { keys: [...new Set([...[...refs.values()].map((ref) => ref.documentId), ...[...workflows].map((id) => WORKFLOW + id)])], unknown };
    });
    const keys = [...new Set(named.flatMap((entry) => entry.keys))];
    const files = await withWorkflowFiles(db, keys.map((key) => [key]));
    const fileOf = new Map(keys.map((key, index) => [key, files[index]?.[0] ?? null]));
    const fileIds = [...new Set([...fileOf.values()].filter((id): id is string => id !== null))];
    const open = new Set(await filterAccessibleDocumentIds(fileIds, reader.userId, reader.userEmail, db));
    const closedIds = fileIds.filter((id) => !open.has(id));
    const existing = new Set(
        (await selectInBatches<{ id: string }>("document existence lookup", closedIds, (batch) => db.from("documents").select("id").in("id", batch))).map((row) => row.id),
    );
    // closed: still there, not openable; gone: no file left to judge.
    const stateOf = (key: string) => {
        const file = fileOf.get(key);
        if (!file) return "gone";
        return open.has(file) ? "open" : existing.has(file) ? "closed" : "gone";
    };

    const result = new Map<string, WithheldReason | null>();
    const chats = new Map<unknown, { seen: Set<string>; unknown: boolean }>();
    messages.forEach((message, index) => {
        const entry = named[index];
        const chat = chats.get(message.chat_id) ?? { seen: new Set<string>(), unknown: false };
        chats.set(message.chat_id, chat);
        const mine = owned.has(message.chat_id as string);
        for (const key of entry.keys) chat.seen.add(key);
        if (entry.unknown && !mine) chat.unknown = true;
        // For the owner, what no longer exists holds nothing back; for any other reader it is not openable.
        const states = [...chat.seen].map((key) => stateOf(key));
        const lost = states.includes("closed");
        const unopenable = mine ? false : states.includes("gone");
        const ownGone = entry.keys.some((key) => stateOf(key) === "gone");
        const withheld = lost || unopenable || chat.unknown || entry.unknown || ownGone;
        // What a person typed is never withheld: their message has no verdict.
        if (message.role === "user") return;
        result.set(String(message.id), withheld ? (lost || !mine ? "no_access" : "source_unknown") : null);
    });
    return result;
}

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
    /** "live" for a transcript read now; "export" (the default) for the holder's own data. */
    gate: "export" | "live" = "export",
): Promise<{ messages: M[]; withheld: Set<string>; reasons: Map<string, WithheldReason> }> {
    const cumulative = cumulativeSources(messages, gate);
    // Per message: the unit of an answer, or the unit of each attachment.
    const unitsOf: Unit[][] = messages.map((message, index) =>
        message.role === "user"
            ? rows(message.files).map((file) => {
                  const id = documentIdOf(file.document_id);
                  // An attachment that names no document gives the assistant nothing.
                  return { sources: id ? [id] : file.document_id ? null : [] };
              })
            : [{ sources: cumulative[index] }],
    );
    const units = unitsOf.flat();
    const resolved = await withWorkflowFiles(db, units.map((unit) => unit.sources));
    const resolvedOf = new Map(units.map((unit, index) => [unit, resolved[index]]));
    const kept = new Set(await keepReadableDerived(db, reader, units, (unit) => resolvedOf.get(unit) ?? null));
    // A transcript read now says why it withholds each answer, and lets the
    // owner of a chat keep the answers that only a source they cannot
    // establish, or a document that no longer exists, held back.
    const reasons = new Map<string, WithheldReason>();
    const answerKept = (message: M, index: number) => kept.has(unitsOf[index][0]);
    let verdicts: Map<string, WithheldReason | null> | null = null;
    if (gate === "live" && messages.some((message, index) => message.role !== "user" && !answerKept(message, index)))
        verdicts = await liveReasons(db, reader, messages);
    const withheld = new Set<string>();
    const out: M[] = [];
    messages.forEach((message, index) => {
        if (message.role !== "user") {
            const reason = verdicts?.get(String(message.id)) ?? null;
            if (verdicts ? reason === null : answerKept(message, index)) out.push(message);
            else {
                withheld.add(message.chat_id as string);
                reasons.set(String(message.id), reason ?? "no_access");
            }
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
    return { messages: out, withheld, reasons };
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
    const cumulative = cumulativeSources(history, "memory");
    const sourcesById = new Map(history.map((row, index) => [row.id, cumulative[index]]));
    const inProject = await documentIdsInProject(
        db,
        cumulative.flatMap((sources) => (sources ?? []).filter((id) => !id.startsWith(WORKFLOW))),
        projectId,
    );
    // A workflow's file is not filed in a project: it is the workflow's, and
    // the person whose turn it was must still be allowed to use it.
    const workflowFiles = await filesOfWorkflows(
        db,
        cumulative.flatMap((sources) => (sources ?? []).filter((id) => !id.startsWith(WORKFLOW) && !inProject.has(id))),
    );
    const eligible = messages.map((message) => {
        const sources = sourcesById.get(message.id) ?? null;
        return sources && sources.every((id) => id.startsWith(WORKFLOW) || inProject.has(id) || workflowFiles.has(id)) ? sources : null;
    });
    const resolved = await withWorkflowFiles(db, eligible);
    const resolvedOf = new Map(messages.map((message, index) => [message, resolved[index]]));
    return keepReadableDerived(db, reader, messages, (message) => resolvedOf.get(message) ?? null);
}

/**
 * `chats` with the title of each one the reader may not read in full replaced
 * by none (the neutral title). A title is written from what the person typed
 * and the names of the files attached to their messages, never from an answer,
 * so it is shown while the reader can open every file attached to the chat.
 * Only the attachments of the chats that have a title are read, in batches,
 * without any message text; if a lookup fails this throws.
 */
export async function withReadableChatTitles<C extends { id?: unknown; title?: unknown }>(
    db: Db,
    reader: DerivedReader,
    chats: C[],
): Promise<C[]> {
    const titled = chats.flatMap((chat) => (chat.title && typeof chat.id === "string" ? [chat.id] : []));
    if (!titled.length) return chats;
    const attachments = await selectInBatches<Row>("chat title attachments", titled, (batch) =>
        selectAllByKey<Row>("chat title attachments", () =>
            db
                .from("chat_messages")
                .select("id, chat_id, role, files, created_at")
                .eq("role", "user")
                .not("files", "is", null)
                .in("chat_id", batch),
        ),
    );
    // One unit per attached file: the document it names, none for a file that names none.
    const units = attachments.flatMap((message) =>
        rows(message.files).map((file) => ({
            chat_id: message.chat_id,
            sources: documentIdOf(file.document_id) ? [file.document_id as string] : file.document_id ? null : [],
        })),
    );
    const kept = await keepReadableDerived(db, reader, units, (unit) => unit.sources);
    return withReadableTitles(chats, units, kept);
}
