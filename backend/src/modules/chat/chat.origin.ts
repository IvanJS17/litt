// Where a conversation was started: the web, Word or a connected app (MCP).
//
// A conversation a connected app starts is an ordinary chats row. Three
// columns (migration 20261117_10) say where it came from so LiTT's history can
// read "Desde <app>" and the connected-apps tab can list what each connection
// started. Provenance only: it grants nothing.

import { selectInBatches } from "../../lib/batchedQuery";
import { type Db } from "../../lib/supabase";
import { getAccessibleChat } from "./chat.access";

/** The connection a conversation was started from. */
export type ChatOrigin = { grantId: string; label: string };

const LABEL_MAX = 120;

/** The columns a NEW chats row carries for its origin (none for the web). */
export function chatOriginColumns(origin: ChatOrigin | undefined): Record<string, unknown> {
    if (!origin) return {};
    return {
        origin: "mcp",
        origin_grant_id: origin.grantId,
        origin_label: origin.label.trim().slice(0, LABEL_MAX) || null,
    };
}

type OriginRow = { id: string; origin: string; origin_label: string | null };

/**
 * Rows of a chat list with `origin` ('web' | 'word' | 'mcp') and
 * `origin_label` (the app's name, or null). Only rows that did not start on
 * the web come back from the database, so the extra read stays small.
 */
export async function withChatOrigin<T extends { id: string }>(
    db: Db,
    chats: T[],
): Promise<{ ok: true; data: (T & { origin: string; origin_label: string | null })[] } | { ok: false; error: unknown }> {
    if (chats.length === 0) return { ok: true, data: [] };
    let found: OriginRow[];
    try {
        found = await selectInBatches<OriginRow>(
            "chat origin lookup",
            chats.map((chat) => chat.id),
            (batch) =>
                db.from("chats").select("id, origin, origin_label").in("id", batch).neq("origin", "web"),
        );
    } catch (error) {
        return { ok: false, error };
    }
    const byId = new Map(found.map((row) => [row.id, row]));
    return {
        ok: true,
        data: chats.map((chat) => ({
            ...chat,
            origin: byId.get(chat.id)?.origin ?? "web",
            origin_label: byId.get(chat.id)?.origin_label ?? null,
        })),
    };
}

export type GrantChat = {
    id: string;
    title: string | null;
    project_id: string | null;
    org_id: string | null;
    created_at: string;
};

/**
 * The newest conversations a connection started for this person, that they can
 * still open (a matter they lost access to is not listed).
 */
export async function listChatsCreatedByGrant(
    db: Db,
    args: { userId: string; userEmail: string | undefined; grantId: string; limit: number },
): Promise<{ ok: true; data: GrantChat[] } | { ok: false; error: unknown }> {
    const { data, error } = await db
        .from("chats")
        .select("id, title, project_id, org_id, created_at")
        .eq("origin_grant_id", args.grantId)
        .eq("user_id", args.userId)
        .order("created_at", { ascending: false })
        .limit(args.limit);
    if (error) return { ok: false, error };
    const rows = (data ?? []) as GrantChat[];
    const access = await Promise.all(
        rows.map((row) => getAccessibleChat(db, { chatId: row.id, userId: args.userId, userEmail: args.userEmail })),
    );
    return { ok: true, data: rows.filter((_, i) => access[i].ok) };
}
