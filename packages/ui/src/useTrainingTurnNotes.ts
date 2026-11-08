"use client";

import { useEffect, useRef, useState } from "react";
import type { TrainingTurnNote } from "@mike/contracts";

/** How often a pending contrast is looked up again, and for how long. */
export const TRAINING_NOTES_POLL_MS = 5_000;
export const TRAINING_NOTES_POLL_MAX_MS = 120_000;
/**
 * A hint or counterpart note is recorded pending and settles as skipped a
 * moment after its answer is delivered (not awaited by the server). Right
 * after a turn ends, one still pending is looked up again for this long
 * before it reads as undelivered.
 */
export const TRAINING_NOTES_DELIVERY_GRACE_MS = 10_000;

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
 * component unmounts. A hint or counterpart note still pending right after
 * its turn ended is held back, and looked up again, for a few seconds (the
 * server settles it after delivering); past that it is shown as undelivered.
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
    const streaming = useRef<{ chatId: string | null | undefined; turnEndedAt: number | null }>({
        chatId: undefined,
        turnEndedAt: null,
    });

    useEffect(() => {
        const turn = streaming.current;
        if (turn.chatId !== chatId) {
            turn.chatId = chatId;
            turn.turnEndedAt = null;
        }
        if (isResponseLoading) {
            turn.turnEndedAt = -1;
            return;
        }
        // -1: a response was streaming a moment ago; this is the end of that turn.
        if (turn.turnEndedAt === -1) turn.turnEndedAt = Date.now();
        if (!chatId) return;
        const turnEndedAt = turn.turnEndedAt;
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
            const now = Date.now();
            // Measured from the end of the turn just finished, or from the note's
            // own creation when the chat was opened later.
            const graceLeft = (n: TrainingTurnNote) =>
                n.contrast_status === "pending" && (n.mode === "hint" || n.mode === "counterpart")
                    ? Math.max(Date.parse(n.created_at) || 0, turnEndedAt ?? 0) +
                      TRAINING_NOTES_DELIVERY_GRACE_MS -
                      now
                    : 0;
            const settling = notes.filter((n) => graceLeft(n) > 0);
            setState({ chatId, notes: notes.filter((n) => !settling.includes(n)) });
            const waiting = notes.some(
                (n) => n.contrast_status === "pending" && n.mode !== "hint" && n.mode !== "counterpart",
            );
            const elapsed = now - (pollStartedAt.current ?? now);
            if (settling.length > 0) {
                const left = Math.min(...settling.map(graceLeft));
                timer = setTimeout(load, Math.min(TRAINING_NOTES_POLL_MS, left));
            } else if (waiting && elapsed < TRAINING_NOTES_POLL_MAX_MS) {
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
