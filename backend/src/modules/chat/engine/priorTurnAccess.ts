// What a new turn replays of the previous answer (the summary of its tool
// activity, its stored reasoning) is a copy of what that answer drew on. It is
// replayed only when the reader can open the documents THAT answer names, now,
// judged as a transcript they read is. Earlier answers reach the model only
// through the transcript, which is judged on its own, so they are not judged
// again here.

import { type DerivedReader } from "../../../lib/access";
import { readableByOwnSources } from "../../../lib/chatReadAccess";
import { type Db } from "../../../lib/supabase";
import { ACTIVE_WORD_DOCUMENT_LIVE_FILENAME } from "./wordPrompt";

type Row = Record<string, unknown>;

/** A live read of the document the person has open in Word names no stored document. */
const withoutActiveWordRead = (event: unknown): boolean => {
    const ev = event as Row | null;
    return !(ev && ev.type === "doc_read" && !ev.document_id && ev.filename === ACTIVE_WORD_DOCUMENT_LIVE_FILENAME);
};

/** The stored answer as the replay judges it: its events without the live read of the open Word document. */
function judged(row: Row): Row {
    if (!Array.isArray(row.content)) return row;
    return {
        ...row,
        content: row.content.filter(withoutActiveWordRead).map((event: Row) =>
            event?.type === "delegation" && Array.isArray(event.events)
                ? { ...event, events: event.events.filter(withoutActiveWordRead) }
                : event,
        ),
    };
}

/**
 * Of the stored answers `rows`, those the reader can open now, each judged on
 * its own sources. A failed lookup throws; the caller decides what to replay
 * without it.
 */
export async function readablePriorRows<R extends Row>(db: Db, reader: DerivedReader, rows: R[], table: string): Promise<Set<R>> {
    // The live read of the open document is written only by the Word chat.
    const byJudged = new Map(rows.map((row) => [table === "word_chat_messages" ? judged(row) : row, row]));
    const kept = await readableByOwnSources(db, reader, [...byJudged.keys()]);
    return new Set([...kept].map((row) => byJudged.get(row)!));
}
