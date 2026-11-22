// May something built from documents leave LiTT through this connection?
//
// One question, asked in one place by every tool that hands a connected
// application text derived from documents (a chat answer, a transcript, a
// review's thread): it may leave when every document it was built from is
// inside the workspaces the connection covers AND is not a trainee's draft a
// mentor has not approved. Unknown provenance does not leave. Each distinct
// document and version is resolved once, in batches, whatever the number of
// citations or messages.

import { TRAINING_APPROVAL_REQUIRED_CODE } from "../../lib/httpError";
import { cumulativeChatSourceRefs } from "../../lib/chatReadAccess";
import { heldSince, heldSources, sourceKey, type SourceRef } from "../../lib/trainingRelease";
import { getAttachmentsOfChats, getMessagesOfChats } from "../chat/chat.service";
import { McpToolError, type McpCall } from "./mcp.tools";
import { documentsOutsideGrant } from "./mcp.toolkit";

/** What a connected application is told when content lies outside the workspaces it covers. */
export const OUTSIDE_CONNECTION_CODE = "content_outside_connection";

export type Release = { ok: true } | { ok: false; reason: "outside_connection" | "held" };

/**
 * For each subject, whether what was built from its `sources` may leave: null
 * sources are unknown provenance. Outside the connection is judged before the
 * hold, so a held draft of another workspace is not even named as held.
 */
export async function decideReleases(call: McpCall, subjects: readonly (readonly SourceRef[] | null)[]): Promise<Release[]> {
    const outside = await documentsOutsideGrant(
        call,
        subjects.flatMap((sources) => (sources ?? []).flatMap((source) => (source.documentId ? [source.documentId] : []))),
    );
    const covered = (sources: readonly SourceRef[] | null) =>
        sources !== null && sources.every((source) => !!source.documentId && !outside.has(source.documentId));
    const held = await heldSources(
        call.db,
        subjects.flatMap((sources) => (covered(sources) ? sources! : [])),
    );
    return subjects.map((sources): Release => {
        if (!covered(sources)) return { ok: false, reason: "outside_connection" };
        return sources!.some((source) => held.has(sourceKey(source))) ? { ok: false, reason: "held" } : { ok: true };
    });
}

/** The fields a withheld turn or message carries instead of its content. */
export const withheldFields = (release: Extract<Release, { ok: false }>) =>
    release.reason === "held"
        ? {
              code: TRAINING_APPROVAL_REQUIRED_CODE,
              withheld_until_approved: true,
              next_step: "This answer draws on a trainee's draft that a mentor has not approved yet. Open it in LiTT.",
          }
        : {
              code: OUTSIDE_CONNECTION_CODE,
              withheld_outside_connection: true,
              next_step: "This answer draws on documents outside the workspaces this connection covers. Open it in LiTT.",
          };

/** The refusal of a tool that would start work over documents outside the connection's workspaces. */
export const outsideConnectionError = (what: string) =>
    new McpToolError(
        OUTSIDE_CONNECTION_CODE,
        `${what} draws on documents outside the workspaces this connection covers.`,
        "Open it in LiTT, or connect the workspace those documents are in.",
    );

type Row = Record<string, unknown>;

/**
 * What a result was built from when no version is recorded: its documents,
 * and either when it was made or "the whole history" of those documents (see
 * `heldSince`).
 */
export type DatedSources = { documentIds: readonly string[] } & ({ since: string | null | undefined } | { wholeHistory: true });

/**
 * For each subject, whether it may leave. As `decideReleases`, except that a
 * held draft is judged by the history of the documents (`heldSince`) rather
 * than by a version named: for what records no version. null sources are
 * unknown provenance.
 */
export async function decideReleasesSince(call: McpCall, subjects: readonly (DatedSources | null)[]): Promise<Release[]> {
    const outside = await documentsOutsideGrant(call, subjects.flatMap((subject) => subject?.documentIds ?? []));
    const covered = (subject: DatedSources | null) => subject !== null && subject.documentIds.every((id) => !outside.has(id));
    const items = subjects.flatMap((subject, index) =>
        subject && covered(subject)
            ? subject.documentIds.map((documentId) => ({ index, moment: "wholeHistory" in subject ? { documentId, wholeHistory: true as const } : { documentId, since: subject.since } }))
            : [],
    );
    const held = await heldSince(call.db, items.map((item) => item.moment));
    const heldSubjects = new Set(items.filter((_, i) => held[i]).map((item) => item.index));
    return subjects.map((subject, index): Release => {
        if (!covered(subject)) return { ok: false, reason: "outside_connection" };
        return heldSubjects.has(index) ? { ok: false, reason: "held" } : { ok: true };
    });
}

/**
 * The release of each assistant message among `wanted`, from the whole chat
 * (`messages`, oldest first): a message can repeat what any earlier one drew
 * on, so it is judged on the sources of everything up to it. What a person
 * typed is not derived from a document and is not judged. Provenance is read
 * strictly (`cumulativeChatSourceRefs`): a search stored without its
 * documents, a read that names no document and a workflow's file reference
 * are unknown, and unknown provenance does not leave. A wanted message that is
 * not among `messages` is unknown too.
 */
export async function chatReleases(call: McpCall, messages: readonly Row[], wanted: ReadonlySet<string>): Promise<Map<string, Release>> {
    const sources = cumulativeChatSourceRefs(messages);
    const picked = messages.flatMap((message, index) => (message.role === "assistant" && wanted.has(String(message.id)) ? [index] : []));
    const decisions = await decideReleases(call, picked.map((index) => sources[index]));
    const releases = new Map<string, Release>(picked.map((index, i) => [String(messages[index].id), decisions[i]]));
    const stored = new Set(messages.map((message) => String(message.id)));
    for (const id of wanted) if (!stored.has(id)) releases.set(id, { ok: false, reason: "outside_connection" });
    return releases;
}

/**
 * The release of one answer of a chat, judged with its own sources from the
 * stored message: the turn a tool reports is read from that message (a turn
 * with text always has one), so a message the complete read of the chat does
 * not find is unknown provenance and withheld. The chat is read completely and
 * a failed read throws: it is an error for the caller, never a release.
 */
export async function chatTurnRelease(call: McpCall, chatId: string, messageId: string): Promise<Release> {
    return (await chatReleases(call, await getMessagesOfChats(call.db, [chatId]), new Set([messageId]))).get(messageId)!;
}

/**
 * The release of the title of each chat. A title is written from what the
 * person typed and the names of the files attached to their messages (the
 * first message of the chat, and whatever a person renames it to), never from
 * an answer or a document's text: it may leave when every file attached to
 * any of the chat's messages of the person may (inside the connection, not a
 * held draft, and naming a document). Only those attachments are read, in
 * batches, without any message text.
 */
export async function titleReleases(call: McpCall, chatIds: readonly string[]): Promise<Map<string, Release>> {
    const ids = [...new Set(chatIds)];
    const attachments = await getAttachmentsOfChats(call.db, ids);
    const refs = cumulativeChatSourceRefs(attachments);
    const ofChat = new Map<string, SourceRef[] | null>();
    attachments.forEach((message, index) => ofChat.set(String(message.chat_id), refs[index]));
    const decisions = await decideReleases(call, ids.map((id) => (ofChat.has(id) ? ofChat.get(id)! : [])));
    return new Map(ids.map((id, i) => [id, decisions[i]]));
}
