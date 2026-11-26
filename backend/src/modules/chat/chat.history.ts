// A conversation read as plain data, for a client that is not the web app:
// the history a new turn continues from, and the state of one turn.
//
// The web sends the whole conversation with every message. A connected app
// sends only its new message, so the history comes from the stored rows,
// shaped the way the web would have sent it.

import { getActiveAssistantTurn, getAssistantTurnRun } from "../../lib/assistantTurnRuns";
import { type DerivedReader } from "../../lib/access";
import { readableChatMessages } from "../../lib/chatReadAccess";
import { type Db } from "../../lib/supabase";
import { getChatMessages, getMessagesOfChats } from "./chat.messages";
import type { ChatMessage } from "./engine/index";

type StoredEvent = { type?: unknown; title?: unknown; text?: unknown; message?: unknown; code?: unknown };
type StoredMessage = Record<string, unknown>;

const eventsOf = (message: StoredMessage): StoredEvent[] =>
    Array.isArray(message.content)
        ? (message.content as unknown[]).filter((e): e is StoredEvent => !!e && typeof e === "object")
        : [];

/** The words of an assistant message: its `content` events, in order. */
export function assistantText(message: StoredMessage): string {
    if (typeof message.content === "string") return message.content;
    return eventsOf(message)
        .filter((event) => event.type === "content" && typeof event.text === "string")
        .map((event) => event.text as string)
        .join("");
}

/** An answer as the web client replays it: its words, with the text cards among them in place. */
function assistantTextWithCards(message: StoredMessage): string {
    const events = eventsOf(message);
    if (!events.some((event) => event.type === "text_card")) return assistantText(message);
    return events
        .flatMap((event) => {
            if (event.type === "content" && typeof event.text === "string") return [event.text];
            if (event.type === "text_card") return [`${String(event.title)}\n${String(event.text)}`];
            return [];
        })
        .join("\n\n");
}

/**
 * The messages of a chat as the web would send them with a new one: those the
 * reader can open now, as a transcript they read is. With `exactlyAsTheWebSends`
 * every answer keeps its place (empty when it has no words) and carries its
 * text cards, as the web's own transcript does.
 */
export async function loadChatHistory(
    db: Db,
    chatId: string,
    reader: DerivedReader,
    options: { exactlyAsTheWebSends?: boolean } = {},
): Promise<ChatMessage[]> {
    // An answer the reader cannot open now comes back emptied, so it has no text to replay.
    const stored = await getChatMessages(db, chatId, reader);
    const history: ChatMessage[] = [];
    for (const message of stored) {
        if (message.role === "user") {
            history.push({
                role: "user",
                content: typeof message.content === "string" ? message.content : null,
                ...(Array.isArray(message.files) && message.files.length ? { files: message.files } : {}),
                ...(message.workflow && typeof message.workflow === "object" ? { workflow: message.workflow } : {}),
                ...(message.playbook && typeof message.playbook === "object" ? { playbook: message.playbook } : {}),
            } as ChatMessage);
        } else if (message.role === "assistant") {
            if (options.exactlyAsTheWebSends) {
                history.push({ role: "assistant", content: assistantTextWithCards(message) });
                continue;
            }
            const text = assistantText(message);
            if (text) history.push({ role: "assistant", content: text });
        }
    }
    return history;
}

export type ChatTurnStatus =
    | "generating"
    | "completed"
    | "needs_input"
    | "stopped"
    | "failed"
    | "interrupted";

export type ChatTurnState = {
    status: ChatTurnStatus;
    messageId: string;
    text: string;
    /** The message's citations as stored (document, page, quote). */
    citations: unknown[];
    /** What happened, summarized: the kind of each event, counted; never their content. */
    events: { type: string; count: number }[];
    /** The authored error text of a failed turn, when the turn recorded one. */
    errorMessage: string | null;
    createdAt: string | null;
    /** The reader cannot open what the answer was built from: it carries no text, events or citations. */
    unreadable?: boolean;
    /** Why: access to a document that still exists was lost, or the answer's sources cannot be established or no longer exist. */
    unreadableReason?: "no_access" | "source_unknown";
};

/**
 * The state of the turn that answers `turnId` (the assistant message's id) in
 * a chat the caller already may open. Null when the chat has no such message.
 * An answer built on documents the reader cannot open is stated without its
 * text, events and citations.
 */
export async function readChatTurn(
    db: Db,
    args: { chatId: string; turnId: string },
    reader: DerivedReader,
): Promise<ChatTurnState | null> {
    const run = getAssistantTurnRun(args.turnId);
    const live = !!run && run.chatId === args.chatId && !run.finished;
    const { data, error } = await db
        .from("chat_messages")
        .select("id, role, content, citations, created_at")
        .eq("id", args.turnId)
        .eq("chat_id", args.chatId)
        .eq("role", "assistant")
        .maybeSingle();
    if (error) throw error;
    if (!data) {
        // A project chat's answer is saved when it ends: until then the turn
        // is a live run with no row yet.
        return live
            ? {
                  messageId: args.turnId,
                  text: "",
                  citations: [],
                  events: [],
                  errorMessage: null,
                  createdAt: null,
                  status: "generating",
              }
            : null;
    }
    // An answer is judged with everything before it in the chat as soon as it
    // has content to judge, also while its run is still registered (the row is
    // empty while the answer is being written, and is not judged then). One the
    // reader cannot open is stated without its words, events and citations,
    // but its state is read from what was stored.
    const stored = data as StoredMessage;
    const judgement =
        stored.content !== null && stored.content !== undefined
            ? await readableChatMessages(db, reader, await getMessagesOfChats(db, [args.chatId]), "live")
            : null;
    const unreadableReason = judgement?.reasons.get(args.turnId);
    const unreadable = !!judgement && !judgement.messages.some((row) => row.id === args.turnId);
    const storedEvents = eventsOf(stored);
    const message = (unreadable ? { ...stored, content: [], citations: null } : stored) as StoredMessage;
    const events = eventsOf(message);
    const counts = new Map<string, number>();
    for (const event of events) {
        const type = typeof event.type === "string" ? event.type : "unknown";
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const error_ = events.find((event) => event.type === "error");
    const base = {
        messageId: args.turnId,
        text: assistantText(message),
        citations: Array.isArray(message.citations) ? (message.citations as unknown[]) : [],
        events: [...counts].map(([type, count]) => ({ type, count })),
        errorMessage: typeof error_?.message === "string" ? error_.message : null,
        createdAt: typeof message.created_at === "string" ? message.created_at : null,
        ...(unreadable ? { unreadable, unreadableReason: unreadableReason ?? ("no_access" as const) } : {}),
    };
    if (live) return { ...base, status: "generating" };
    if (stored.content === null || stored.content === undefined) {
        // Reserved but never filled: the run ended without saving (an empty
        // answer, a provider error) or the process restarted under it.
        const ended = !!run && run.chatId === args.chatId && run.finished;
        return { ...base, status: ended ? (run.stopReason === "user" ? "stopped" : "failed") : "interrupted" };
    }
    if (storedEvents.some((event) => event.type === "error")) return { ...base, status: "failed" };
    if (storedEvents.some((event) => event.type === "stopped")) return { ...base, status: "stopped" };
    if (storedEvents.some((event) => event.type === "ask_inputs")) return { ...base, status: "needs_input" };
    return { ...base, status: "completed" };
}

/** The turn generating into this chat right now, if any. */
export const activeChatTurn = (chatId: string): { id: string; assistant_message_id: string } | null => {
    const active = getActiveAssistantTurn(chatId);
    return active ? { id: active.id, assistant_message_id: active.assistant_message_id } : null;
};

/** Stop the live turn `turnId` of a chat. `finished` when it already ended; null when it is unknown. */
export function stopChatTurn(args: { chatId: string; turnId: string }): { stopped: boolean; finished: boolean } | null {
    const run = getAssistantTurnRun(args.turnId);
    if (!run || run.chatId !== args.chatId) return null;
    if (run.finished) return { stopped: false, finished: true };
    run.stop();
    return { stopped: true, finished: false };
}
