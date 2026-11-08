// Which document a junior is asked to read (docs/training.md, layer 3).
//
// LiTT proposes one at random from the matters the person worked in during the
// last READING_WORK_WINDOW_DAYS, that they can open and where they are at the
// junior stage, with a stored text that is neither empty nor longer than a
// person reads whole. The stage only decides WHICH matters are proposed: the
// document is read under the person's own access to it (read_document_text
// asks the same rule as the viewer), so a stage never opens anything.

import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { resolveTrainingStage } from "../../lib/training";
import { isReadableDocumentText, READING_CANDIDATE_TRIES, readingWorkSince } from "../../lib/trainingReading";
import { openableWorkMatters } from "../../lib/trainingWork";
import { readStoredDocumentText } from "../documents/documents.service";

export const READING_NO_DOCUMENT_CODE = "training_reading_no_document";
const NO_DOCUMENT = "There is no document to propose yet. Work on a matter and come back.";
const RECENT_NOTES = 300;
const MAX_PROJECTS = 30;
const MAX_DOCUMENTS = 300;

export type ReadingPick = { projectId: string; documentId: string; versionId: string };

function shuffled<T>(values: readonly T[], random: () => number): T[] {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** The matters of the person's recent work in the organization. */
async function recentProjects(
    db: Db,
    args: { orgId: string; userId: string; now: number },
): Promise<ServiceResult<string[]>> {
    const since = readingWorkSince(args.now);
    const notes = await db
        .from("training_turn_notes")
        .select("chat_id, tabular_chat_id, created_at")
        .eq("org_id", args.orgId)
        .eq("trainee_user_id", args.userId)
        .order("created_at", { ascending: false })
        .limit(RECENT_NOTES);
    if (notes.error) return internalFailure(notes.error);
    const recent = ((notes.data ?? []) as { chat_id: string | null; tabular_chat_id: string | null; created_at: string }[])
        .filter((note) => note.created_at >= since);
    const chatIds = [...new Set(recent.map((note) => note.chat_id).filter((id): id is string => !!id))];
    const tabularChatIds = [...new Set(recent.map((note) => note.tabular_chat_id).filter((id): id is string => !!id))];

    const projects = new Set<string>();
    if (chatIds.length > 0) {
        const chats = await db.from("chats").select("id, project_id").in("id", chatIds);
        if (chats.error) return internalFailure(chats.error);
        for (const chat of (chats.data ?? []) as { project_id: string | null }[])
            if (chat.project_id) projects.add(chat.project_id);
    }
    if (tabularChatIds.length > 0) {
        const chats = await db.from("tabular_review_chats").select("id, review_id").in("id", tabularChatIds);
        if (chats.error) return internalFailure(chats.error);
        const reviewIds = [
            ...new Set(((chats.data ?? []) as { review_id: string | null }[]).map((chat) => chat.review_id).filter((id): id is string => !!id)),
        ];
        if (reviewIds.length > 0) {
            const reviews = await db.from("tabular_reviews").select("id, project_id").in("id", reviewIds);
            if (reviews.error) return internalFailure(reviews.error);
            for (const review of (reviews.data ?? []) as { project_id: string | null }[])
                if (review.project_id) projects.add(review.project_id);
        }
    }
    return ok([...projects]);
}

/**
 * A document to read, or the reason there is none. `exclude` is the document
 * already proposed (a swap never proposes the same one again).
 */
export async function pickReadingDocument(
    db: Db,
    args: {
        orgId: string;
        userId: string;
        userEmail: string | null;
        exclude?: string | null;
        now?: number;
        random?: () => number;
    },
): Promise<ServiceResult<ReadingPick>> {
    const now = args.now ?? Date.now();
    const random = args.random ?? Math.random;
    try {
        const recent = await recentProjects(db, { orgId: args.orgId, userId: args.userId, now });
        if (!recent.ok) return recent;
        if (recent.data.length === 0) return failure("validation", NO_DOCUMENT, READING_NO_DOCUMENT_CODE);

        // Matters of this organization that the person can open, and where they are juniors.
        const inOrg = await db.from("projects").select("id, org_id").in("id", recent.data.slice(0, MAX_PROJECTS * 2));
        if (inOrg.error) return internalFailure(inOrg.error);
        const candidates = ((inOrg.data ?? []) as { id: string; org_id: string | null }[])
            .filter((project) => project.org_id === args.orgId)
            .map((project) => project.id)
            .slice(0, MAX_PROJECTS);
        const openable = candidates.length
            ? await openableWorkMatters(db, { projectIds: candidates, actorId: args.userId, actorEmail: args.userEmail })
            : new Set<string>();
        const projectIds: string[] = [];
        for (const projectId of candidates) {
            if (!openable.has(projectId)) continue;
            const stage = await resolveTrainingStage(db, args.userId, { orgId: args.orgId, projectId });
            if (stage === "junior") projectIds.push(projectId);
        }
        if (projectIds.length === 0) return failure("validation", NO_DOCUMENT, READING_NO_DOCUMENT_CODE);

        const documents = await db
            .from("documents")
            .select("id, project_id, current_version_id")
            .in("project_id", projectIds)
            .is("archived_at", null)
            .eq("library_kind", "file")
            .not("current_version_id", "is", null)
            .limit(MAX_DOCUMENTS);
        if (documents.error) return internalFailure(documents.error);
        const pool = (
            (documents.data ?? []) as { id: string; project_id: string; current_version_id: string }[]
        ).filter((doc) => doc.id !== args.exclude);

        for (const doc of shuffled(pool, random).slice(0, READING_CANDIDATE_TRIES)) {
            const stored = await readStoredDocumentText(db, {
                userId: args.userId,
                userEmail: args.userEmail,
                documentId: doc.id,
                versionId: doc.current_version_id,
            });
            if (stored?.status === "ready" && isReadableDocumentText(stored.text))
                return ok({ projectId: doc.project_id, documentId: doc.id, versionId: doc.current_version_id });
        }
        return failure("validation", NO_DOCUMENT, READING_NO_DOCUMENT_CODE);
    } catch (error) {
        return internalFailure(error);
    }
}
