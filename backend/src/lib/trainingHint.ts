// LiTT training, layer 3 (docs/training.md): the hint ladder and the
// counterparty-lawyer round, as the server counts them.
//
// A hint and a counterpart turn are ordinary chat turns that leave their mode
// and step in the turn's private note. The server decides the step from the
// notes the chat already holds, never from the request: the client only says
// "a hint" or "a counterpart turn", so a rung cannot be skipped, repeated or
// faked in the mentor's record.
//
//   hint               rungs 1 to 3: approach, where to look, what to review.
//                      The ladder is the run of hint notes at the end of the
//                      chat; any other turn (the full answer) starts it over.
//   counterpart        up to three turns of one round.
//   counterpart_close  ends the round with a contrast; the next turn opens a
//                      new round.
//
// And the footer: LiTT has no corpus of laws, so a legal reference the model
// names that no verified citation of the turn backs is marked «sin verificar»
// by the server (unverifiedLegalFooter), not by the model.

import { hasKnownLaw, lawOfTitle, lawReferences } from "./legalReferences";
import type { Db } from "./supabase";
import { TURN_NOTE_CHAT_COLUMN, type TurnNoteSurface } from "./trainingNotes";

export const HINT_MAX_LEVEL = 3;
export const COUNTERPART_MAX_ROUNDS = 3;

export type HintLevel = 1 | 2 | 3;
export type LadderMode = "hint" | "counterpart" | "counterpart_close";

/** What the ladder needs of a note. */
export type LadderNote = { mode: string | null; step: number | null; attempt?: string; contrast_status?: string };

/** The notes of a chat the ladder looks at: the run it needs is at most four long. */
const LADDER_WINDOW = 24;

/** Consecutive notes of `mode` at the end of the chat. `newestFirst`. */
function trailingRun(newestFirst: readonly LadderNote[], mode: LadderMode): LadderNote[] {
    const run: LadderNote[] = [];
    for (const note of newestFirst) {
        if (note.mode !== mode) break;
        run.push(note);
    }
    return run;
}

/** The rung the next hint would be, or null once the ladder is used up. */
export function nextHintLevel(newestFirst: readonly LadderNote[]): HintLevel | null {
    const used = trailingRun(newestFirst, "hint").length;
    return used >= HINT_MAX_LEVEL ? null : ((used + 1) as HintLevel);
}

export type CounterpartState = {
    /** Turns of the open round so far. */
    turns: number;
    /** The step the next counterpart turn would take, or null when the round is full. */
    nextStep: HintLevel | null;
    /** A round with at least one turn can be closed. */
    canClose: boolean;
    /** The attempts of the open round, oldest first. */
    attempts: string[];
};

export function counterpartState(newestFirst: readonly LadderNote[]): CounterpartState {
    const run = trailingRun(newestFirst, "counterpart");
    return {
        turns: run.length,
        nextStep: run.length >= COUNTERPART_MAX_ROUNDS ? null : ((run.length + 1) as HintLevel),
        canClose: run.length > 0,
        attempts: run.map((note) => note.attempt ?? "").reverse(),
    };
}

export type Ladder = { hint: HintLevel | null; counterpart: CounterpartState };

export function ladderOf(newestFirst: readonly LadderNote[]): Ladder {
    return { hint: nextHintLevel(newestFirst), counterpart: counterpartState(newestFirst) };
}

/**
 * The chat's last notes, newest first. A chat the surface does not keep, or a
 * new one, has none: the ladder starts at its first rung. Only the person's
 * own notes are read (`trainee_user_id`), so an id that is somebody else's
 * chat simply has no notes.
 */
export async function loadLadderNotes(
    db: Db,
    args: { userId: string; chat: { surface: TurnNoteSurface; chatId: string } | null },
): Promise<{ ok: true; notes: LadderNote[] } | { ok: false; error: unknown }> {
    if (!args.chat) return { ok: true, notes: [] };
    const { data, error } = await db
        .from("training_turn_notes")
        .select("mode, step, attempt, contrast_status, created_at")
        .eq("trainee_user_id", args.userId)
        .eq(TURN_NOTE_CHAT_COLUMN[args.chat.surface], args.chat.chatId)
        .order("created_at", { ascending: false })
        .limit(LADDER_WINDOW);
    if (error) return { ok: false, error };
    const rows = Array.isArray(data) ? (data as unknown as LadderNote[]) : [];
    return { ok: true, notes: rows.filter(delivered) };
}

/**
 * A hint or a counterpart turn is recorded `pending` and only becomes
 * `skipped` (finishTrainingTurn) once its answer was delivered. One still
 * pending failed or was aborted before: it gave the person nothing, so it is
 * not a rung. Every other note counts as it was written.
 */
function delivered(note: LadderNote): boolean {
    return !((note.mode === "hint" || note.mode === "counterpart") && note.contrast_status === "pending");
}

/**
 * The same for a chat id whose surface the caller does not say (the stage
 * endpoint): the three columns are tried in turn. Chat ids are uuids, so at
 * most one holds the person's notes.
 */
export async function loadLadderNotesAnywhere(
    db: Db,
    args: { userId: string; chatId: string },
): Promise<{ ok: true; notes: LadderNote[] } | { ok: false; error: unknown }> {
    for (const surface of Object.keys(TURN_NOTE_CHAT_COLUMN) as TurnNoteSurface[]) {
        const loaded = await loadLadderNotes(db, { userId: args.userId, chat: { surface, chatId: args.chatId } });
        if (!loaded.ok || loaded.notes.length > 0) return loaded;
    }
    return { ok: true, notes: [] };
}

// ---------------------------------------------------------------------------
// «Sin verificar»
// ---------------------------------------------------------------------------

export const UNVERIFIED_LEGAL_FOOTER =
    "Sin verificar: las leyes, artículos o tesis que se nombran arriba no vienen de un documento leído en este turno. Confírmalos en la fuente oficial.";

/** A passage a verified citation holds, with the title of the document it comes from. */
type VerifiedPassage = { text: string; title: string | null };

/**
 * Every passage of the verified citations of a turn, each with its document's
 * title (filename, doc_name or document.title, as lib/trainingTurn/accountability
 * reads them; a quote inherits its citation's).
 */
function verifiedPassages(value: unknown, inherited: string | null = null, depth = 0): VerifiedPassage[] {
    if (depth > 6 || value === null || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap((item) => verifiedPassages(item, inherited, depth + 1));
    const record = value as Record<string, unknown>;
    const document = record.document as Record<string, unknown> | null | undefined;
    const title =
        [record.filename, record.doc_name, document?.title].find(
            (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
        ) ?? inherited;
    const verification = record.verification as Record<string, unknown> | undefined;
    const backed = record.verified === true || verification?.verified === true;
    const own: VerifiedPassage[] = backed
        ? Object.values(record)
              .flatMap((field) => (typeof field === "string" ? [field] : []))
              .concat(typeof verification?.source_excerpt === "string" ? [verification.source_excerpt] : [])
              .map((text) => ({ text, title }))
        : [];
    return [
        ...own,
        ...verifiedPassages(record.quotes, title, depth + 1),
        ...verifiedPassages(record.document, title, depth + 1),
    ];
}

/**
 * The «sin verificar» line to append to an answer, or null. A reference counts
 * as backed only when a citation the server verified in this turn holds the
 * same article of the SAME law (article 1949 of the Código Civil is not
 * article 1949 of the Ley Federal del Trabajo); everything else the model
 * remembers is flagged, and so is an article whose law cannot be established
 * on either side (fails closed). Never throws.
 */
export function unverifiedLegalFooter(
    answer: string,
    citations: unknown,
    footer: string = UNVERIFIED_LEGAL_FOOTER,
): string | null {
    try {
        const named = lawReferences(answer);
        if (named.size === 0) return null;
        const backed = new Set<string>();
        for (const { text, title } of verifiedPassages(citations))
            for (const reference of lawReferences(text, lawOfTitle(title))) backed.add(reference);
        for (const reference of named) if (!hasKnownLaw(reference) || !backed.has(reference)) return footer;
        return null;
    } catch {
        return null;
    }
}
