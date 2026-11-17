// A conversation read as plain data, for a client that is not the web app:
// the history a new turn continues from, and the state of one turn.
//
// The web sends the whole conversation with every message. A connected app
// sends only its new message, so the history comes from the stored rows,
// shaped the way the web would have sent it.

import { getActiveAssistantTurn, getAssistantTurnRun } from "../../lib/assistantTurnRuns";
import { type Db } from "../../lib/supabase";
import { getChatMessages } from "./chat.messages";
import type { ChatMessage } from "./engine/index";

type StoredEvent = { type?: unknown; text?: unknown; message?: unknown; code?: unknown };
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

/** The messages of a chat as the web would send them with a new one. */
export async function loadChatHistory(db: Db, chatId: string): Promise<ChatMessage[]> {
    const stored = await getChatMessages(db, chatId);
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
};

/**
 * The state of the turn that answers `turnId` (the assistant message's id) in
 * a chat the caller already may open. Null when the chat has no such message.
 */
export async function readChatTurn(
    db: Db,
    args: { chatId: string; turnId: string },
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
    if (!data) return null;
    const message = data as StoredMessage;
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
    };
    if (live) return { ...base, status: "generating" };
    if (message.content === null || message.content === undefined) {
        // Reserved but never filled: the run ended without saving (an empty
        // answer, a provider error) or the process restarted under it.
        const ended = !!run && run.chatId === args.chatId && run.finished;
        return { ...base, status: ended ? (run.stopReason === "user" ? "stopped" : "failed") : "interrupted" };
    }
    if (error_) return { ...base, status: "failed" };
    if (events.some((event) => event.type === "stopped")) return { ...base, status: "stopped" };
    if (events.some((event) => event.type === "ask_inputs")) return { ...base, status: "needs_input" };
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
