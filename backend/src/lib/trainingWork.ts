// LiTT training (docs/training.md): a pupil's piece of work is one chat with
// turn notes, on one surface. Its learning data is the pupil's and their
// current mentor's (training_can_read_learning), but a work done inside a
// matter also carries that matter's confidentiality: a mentor who cannot open
// the matter does not read the work, its notes or its review (layer 2, open
// question 6). Word has no matter; a chat outside a project has none either.

import { loadOpenableProjects } from "./access";
import { mayReadWordChat } from "./chatReadAccess";
import type { Db } from "./supabase";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "./trainingNotes";

export const WORK_SURFACES = Object.keys(TURN_NOTE_CHAT_COLUMN) as TurnNoteSurface[];

export function isWorkSurface(value: unknown): value is TurnNoteSurface {
    return typeof value === "string" && (WORK_SURFACES as string[]).includes(value);
}

/** `wordChatId` is set for a Word chat: it has no matter, its answers are judged by what they drew on. */
export type WorkPlace = { projectId: string | null; title: string | null; wordChatId?: string };

/** The matter's project and the title of a work's chat; null when the chat is gone. Not exported: callers use judgeWorks. */
async function workPlace(
    db: Db,
    surface: TurnNoteSurface,
    chatId: string,
): Promise<{ ok: true; place: WorkPlace | null } | { ok: false; error: unknown }> {
    if (surface === "word") {
        const { data, error } = await db.from("word_chats").select("id, title").eq("id", chatId).maybeSingle();
        if (error) return { ok: false, error };
        const row = data as { title?: string | null } | null;
        return { ok: true, place: row ? { projectId: null, title: row.title ?? null, wordChatId: chatId } : null };
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

/** The person asking: what they can open decides what they are shown. */
export type WorkReader = { actorId: string; actorEmail: string | null };
export type WorkRef = { surface: TurnNoteSurface; chatId: string };
/** `place` is null when the work's chat is gone (then nothing is shown). */
export type WorkSight = { place: WorkPlace | null; open: boolean };

export const workKey = (work: WorkRef) => `${work.surface}:${work.chatId}`;

/**
 * Of `projectIds`, the matters the reader may open now, asked once for the
 * whole list. For what is made from a matter that is not a chat's work (a
 * reading, an audit of a review, a document). Throws when it cannot be answered.
 */
export async function openMatters(db: Db, reader: WorkReader, projectIds: readonly string[]): Promise<Set<string>> {
    if (projectIds.length === 0) return new Set();
    const opened = await loadOpenableProjects(db, reader.actorId, reader.actorEmail, [...new Set(projectIds)]);
    return new Set(opened.keys());
}

async function judge(db: Db, works: readonly WorkRef[], reader: WorkReader, answers: boolean): Promise<Map<string, WorkSight>> {
    const unique = new Map<string, WorkRef>();
    for (const work of works) unique.set(workKey(work), work);
    const places = new Map<string, WorkPlace | null>();
    for (const [key, work] of unique) {
        const found = await workPlace(db, work.surface, work.chatId);
        if (!found.ok) throw found.error;
        places.set(key, found.place);
    }
    const matters = await openMatters(
        db,
        reader,
        [...places.values()].flatMap((place) => (place?.projectId ? [place.projectId] : [])),
    );
    const sights = new Map<string, WorkSight>();
    for (const [key, place] of places) {
        let open = place !== null && (!place.projectId || matters.has(place.projectId));
        // A Word chat has no matter: its work is read while the reader can open what its answers drew on.
        if (open && answers && place?.wordChatId)
            open = await mayReadWordChat(db, { userId: reader.actorId, userEmail: reader.actorEmail }, place.wordChatId);
        sights.set(key, { place, open });
    }
    return sights;
}

/**
 * THE decision of every training reader that serves text, a title or an
 * excerpt computed from a work: for each work, whether `reader` may see it
 * now. The matter rule (a work done in a matter) and, for a work made from a
 * Word chat, that the reader can open now what its answers drew on. Each chat
 * is judged once however often it is named. Throws when a lookup fails: never
 * a grant. The key of the result is `workKey`.
 */
export function judgeWorks(db: Db, works: readonly WorkRef[], reader: WorkReader): Promise<Map<string, WorkSight>> {
    return judge(db, works, reader, true);
}

/** The same decision for one work. */
export async function judgeWork(db: Db, work: WorkRef, reader: WorkReader): Promise<WorkSight> {
    return (await judge(db, [work], reader, true)).get(workKey(work)) as WorkSight;
}

/**
 * The matter rule alone, for the one reader that judges a chat's answers
 * itself, answer by answer: the account export. Anything else uses judgeWorks.
 */
export function judgeWorkMatters(db: Db, works: readonly WorkRef[], reader: WorkReader): Promise<Map<string, WorkSight>> {
    return judge(db, works, reader, false);
}
