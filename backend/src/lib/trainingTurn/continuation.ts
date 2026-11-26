// Answering a paused turn's questions continues that turn; it is not a new one.
// For a person in training, whatever the request carries after the paused
// assistant message is therefore not taken as what they say: the model gets
// one fixed line there (with the files the answers attached), since a new
// question would otherwise reach it with no approach and no note.
//
// Layering: this is `lib/`, so it imports nothing from `modules/`.

import type { Db } from "../supabase";
import { resolveTurnTraining } from "../trainingPass";
import type { TrainingScope } from "../training";

const CONTINUATION_TEXT = "The answers to your questions are recorded above. Continue from them.";

export async function continuationMessages<M extends { role: string; content: string | null; files?: unknown }>(
    db: Db,
    userId: string,
    scope: TrainingScope,
    messages: M[],
): Promise<M[]> {
    // The paused message is the last assistant one that a user message follows
    // (the answers). With none, the request carries no history to continue
    // from, and the model gets the fixed line alone.
    let paused = -1;
    for (let i = messages.length - 2; i >= 0; i--) {
        if (messages[i]!.role === "assistant" && messages.slice(i + 1).some((m) => m.role === "user")) {
            paused = i;
            break;
        }
    }
    if ((await resolveTurnTraining(db, userId, scope)).stage !== "pasante") return messages;
    const files = [...messages.slice(paused + 1)].reverse().find((m) => m.role === "user")?.files;
    return [
        ...messages.slice(0, paused + 1),
        { role: "user", content: CONTINUATION_TEXT, ...(files ? { files } : {}) } as M,
    ];
}
