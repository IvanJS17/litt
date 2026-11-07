// LiTT training (docs/training.md): a pupil's piece of work is one chat with
// turn notes, on one surface. Its learning data is the pupil's and their
// current mentor's (training_can_read_learning), but a work done inside a
// matter also carries that matter's confidentiality: a mentor who cannot open
// the matter does not read the work, its notes or its review (layer 2, open
// question 6). Word has no matter; a chat outside a project has none either.

import { checkProjectAccess } from "./access";
import type { Db } from "./supabase";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "./trainingNotes";

export const WORK_SURFACES = Object.keys(TURN_NOTE_CHAT_COLUMN) as TurnNoteSurface[];

export function isWorkSurface(value: unknown): value is TurnNoteSurface {
    return typeof value === "string" && (WORK_SURFACES as string[]).includes(value);
}

export type WorkPlace = { projectId: string | null; title: string | null };

/** The matter's project and the title of a work's chat; null when the chat is gone. */
export async function workPlace(
    db: Db,
    surface: TurnNoteSurface,
    chatId: string,
): Promise<{ ok: true; place: WorkPlace | null } | { ok: false; error: unknown }> {
    if (surface === "word") {
        const { data, error } = await db.from("word_chats").select("id, title").eq("id", chatId).maybeSingle();
        if (error) return { ok: false, error };
        const row = data as { title?: string | null } | null;
        return { ok: true, place: row ? { projectId: null, title: row.title ?? null } : null };
    }
    if (surface === "chat") {
        const { data, error } = await db
            .from("chats")
            .select("id, project_id, title")
            .eq("id", chatId)
            .maybeSingle();
        if (error) return { ok: false, error };
        const row = data as { project_id?: string | null; title?: string | null } | null;
        return {
            ok: true,
            place: row ? { projectId: row.project_id ?? null, title: row.title ?? null } : null,
        };
    }
    const { data, error } = await db
        .from("tabular_review_chats")
        .select("id, review_id, title")
        .eq("id", chatId)
        .maybeSingle();
    if (error) return { ok: false, error };
    const chat = data as { review_id?: string; title?: string | null } | null;
    if (!chat?.review_id) return { ok: true, place: null };
    const review = await db
        .from("tabular_reviews")
        .select("id, project_id")
        .eq("id", chat.review_id)
        .maybeSingle();
    if (review.error) return { ok: false, error: review.error };
    const projectId = (review.data as { project_id?: string | null } | null)?.project_id ?? null;
    return { ok: true, place: { projectId, title: chat.title ?? null } };
}

/** Whether the actor may open the matter a work was done in (none: yes). */
export async function mayOpenWorkMatter(
    db: Db,
    args: { projectId: string | null; actorId: string; actorEmail: string | null },
): Promise<boolean> {
    if (!args.projectId) return true;
    const access = await checkProjectAccess(args.projectId, args.actorId, args.actorEmail, db);
    return access.ok;
}
