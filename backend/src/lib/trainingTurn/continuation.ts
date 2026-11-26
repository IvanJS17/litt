// Answering a paused turn's questions continues that turn; it is not a new one.
// For a person in training the model therefore gets the conversation as it is
// stored, up to the paused assistant message (the chat's latest one), and one
// fixed line after it (with the files the answers attached). Nothing else the
// request carries reaches it: a new question would otherwise be answered with
// no approach and no note. The files of the fixed line are kept only when they
// are documents the turn can see, and are named as stored (`storedFilesOnly`).
//
// Layering: this is `lib/`, so it imports nothing from `modules/`; the caller
// hands over the loader of the stored conversation, called only when it is needed.

import type { Db } from "../supabase";
import { resolveTurnTraining } from "../trainingPass";
import type { TrainingScope } from "../training";

const CONTINUATION_TEXT = "The answers to your questions are recorded above. Continue from them.";

export async function continuationMessages<M extends { role: string; content: string | null; files?: unknown }>(
    db: Db,
    userId: string,
    scope: TrainingScope,
    messages: M[],
    loadStored: () => Promise<M[]>,
): Promise<{ messages: M[]; inTraining: boolean }> {
    if ((await resolveTurnTraining(db, userId, scope)).stage !== "pasante") return { messages, inTraining: false };
    const stored = await loadStored();
    const paused = stored.map((m) => m.role).lastIndexOf("assistant");
    const files = [...messages].reverse().find((m) => m.role === "user")?.files;
    return {
        messages: [
            ...stored.slice(0, paused + 1),
            { role: "user", content: CONTINUATION_TEXT, ...(files ? { files } : {}) } as M,
        ],
        inTraining: true,
    };
}

type FileRef = { filename: string; document_id?: string | null };

/**
 * The fixed line's files for a person in training: an entry stays only when its
 * `document_id` is a document of the turn (`docIndex`), under its stored name.
 */
export function storedFilesOnly<M extends { files?: unknown }>(
    messages: M[],
    docIndex: Record<string, { document_id: string; filename: string }>,
): M[] {
    const storedName = new Map(Object.values(docIndex).map((d) => [d.document_id, d.filename] as const));
    return messages.map((m, i) => {
        if (i !== messages.length - 1 || !Array.isArray(m.files)) return m;
        const files = (m.files as FileRef[]).flatMap((f) => {
            const filename = f.document_id ? storedName.get(f.document_id) : undefined;
            return filename === undefined ? [] : [{ ...f, filename }];
        });
        return { ...m, files };
    });
}
