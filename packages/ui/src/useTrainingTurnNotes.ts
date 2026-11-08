"use client";

import { useEffect, useRef, useState } from "react";
import type { TrainingTurnNote } from "@mike/contracts";
import { isUndeliveredModeNote } from "./TrainingNoteUI";

/** How often a pending contrast is looked up again, and for how long. */
export const TRAINING_NOTES_POLL_MS = 5_000;
export const TRAINING_NOTES_POLL_MAX_MS = 120_000;

interface NoteMessage {
    id?: string;
    role: string;
    attempt?: string;
    /** A hint or a counterparty turn (card 6): its note is the one with that mode. */
    training_mode?: string | null;
}

/**
 * LiTT training: the private notes of a chat's turns, read from the server.
 * A chat nobody may read notes on (or without any) yields an empty list.
 * Reloads when a response finishes; while a contrast is pending it polls
 * every 5 s for at most 2 minutes, and stops when the chat changes or the
 * component unmounts.
 */
export function useTrainingTurnNotes(
    chatId: string | null | undefined,
    isResponseLoading: boolean,
    /** Reads the notes of a chat; the web app and the Word add-in each have their own client. */
    getTrainingTurnNotes: (chatId: string) => Promise<TrainingTurnNote[]>,
): TrainingTurnNote[] {
    const [state, setState] = useState<{
        chatId: string;
        notes: TrainingTurnNote[];
    } | null>(null);
    const pollStartedAt = useRef<number | null>(null);

    useEffect(() => {
        if (!chatId || isResponseLoading) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        pollStartedAt.current = Date.now();

        const load = async () => {
            let notes: TrainingTurnNote[];
            try {
                notes = await getTrainingTurnNotes(chatId);
            } catch {
                return;
            }
            // The panel is secondary: a malformed answer must never take the chat down.
            if (cancelled || !Array.isArray(notes)) return;
            setState({ chatId, notes });
            const waiting = notes.some((n) => n.contrast_status === "pending" && !isUndeliveredModeNote(n));
            const elapsed = Date.now() - (pollStartedAt.current ?? Date.now());
            if (waiting && elapsed < TRAINING_NOTES_POLL_MAX_MS) {
                timer = setTimeout(load, TRAINING_NOTES_POLL_MS);
            }
        };
        void load();
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [chatId, isResponseLoading, getTrainingTurnNotes]);

    return state && state.chatId === chatId ? state.notes : [];
}

/**
 * The note of each user message, by message index. Saved messages match on
 * their id. A message just sent in this session has no saved id yet (the web
 * leaves the id out, the Word add-in gives it one of its own); it carries the
 * `attempt` it was sent with and takes an unclaimed note with exactly that
 * attempt and mode, newest with newest. A just-sent message whose note was never
 * created stays bare instead of borrowing another turn's note. The one case
 * left ambiguous is two just-sent turns with the identical attempt, whose
 * notes then differ only in their contrast (see docs/training.md).
 */
export function matchTrainingNotes(
    messages: NoteMessage[],
    notes: TrainingTurnNote[],
): Map<number, TrainingTurnNote> {
    const matched = new Map<number, TrainingTurnNote>();
    if (notes.length === 0) return matched;
    const byId = new Map(notes.map((n) => [n.message_id, n]));
    const claimed = new Set<string>();
    const live: { index: number; attempt: string; mode: string | null }[] = [];
    messages.forEach((m, index) => {
        if (m.role !== "user") return;
        const note = m.id ? byId.get(m.id) : undefined;
        if (note) {
            matched.set(index, note);
            claimed.add(note.id);
        } else if (m.attempt) {
            live.push({ index, attempt: m.attempt.trim(), mode: m.training_mode ?? null });
        }
    });
    const spare = notes
        .filter((n) => !claimed.has(n.id))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const { index, attempt, mode } of live.reverse()) {
        // A hint keeps the approach for the turn after it: the same words can
        // head a hint, a round turn and a full answer, told apart by mode.
        const at = spare.findIndex((n) => n.attempt === attempt && (n.mode ?? null) === mode);
        if (at < 0) continue;
        matched.set(index, spare[at] as TrainingTurnNote);
        spare.splice(at, 1);
    }
    return matched;
}
