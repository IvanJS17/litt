// Answering a paused turn's questions continues that turn; it is not a new one.
// For a person in training the model therefore gets the conversation as it is
// stored, up to the paused assistant message (the chat's latest one), and one
// fixed line after it (with the files the answers attached). Nothing else the
// request carries reaches it: a new question would otherwise be answered with
// no approach and no note.
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
): Promise<M[]> {
    if ((await resolveTurnTraining(db, userId, scope)).stage !== "pasante") return messages;
    const stored = await loadStored();
    const paused = stored.map((m) => m.role).lastIndexOf("assistant");
    const files = [...messages].reverse().find((m) => m.role === "user")?.files;
    return [
        ...stored.slice(0, paused + 1),
        { role: "user", content: CONTINUATION_TEXT, ...(files ? { files } : {}) } as M,
    ];
}
