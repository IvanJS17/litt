// What a new turn replays of the previous answer (the summary of its tool
// activity, its stored reasoning) is a copy of what that answer drew on. It is
// replayed only when the reader can open the documents THAT answer names, now,
// judged as a transcript they read is. Earlier answers reach the model only
// through the transcript, which is judged on its own, so they are not judged
// again here.

import { type DerivedReader } from "../../../lib/access";
import { readableByOwnSources } from "../../../lib/chatReadAccess";
import { type Db } from "../../../lib/supabase";

type Row = Record<string, unknown>;

/**
 * Of the stored answers `rows`, those the reader can open now, each judged on
 * its own sources. A failed lookup throws; the caller decides what to replay
 * without it.
 */
export async function readablePriorRows<R extends Row>(db: Db, reader: DerivedReader, rows: R[], table: string): Promise<Set<R>> {
    // The open Word document is the add-in's own text, not a stored source:
    // the shared judgement knows that for the Word chat table.
    return readableByOwnSources(db, reader, rows, table === "word_chat_messages" ? "word_chat_messages" : "chat_messages");
}
