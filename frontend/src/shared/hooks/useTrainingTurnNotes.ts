"use client";

import { useEffect, useRef, useState } from "react";
import type { TrainingTurnNote } from "@mike/contracts";

/** How often a pending contrast is looked up again, and for how long. */
export const TRAINING_NOTES_POLL_MS = 5_000;
export const TRAINING_NOTES_POLL_MAX_MS = 120_000;

interface NoteMessage {
    id?: string;
    role: string;
    attempt?: string;
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
            if (cancelled) return;
            setState({ chatId, notes });
            const waiting = notes.some((n) => n.contrast_status === "pending");
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
 * `attempt` it was sent with, and takes the notes no saved message claimed,
 * newest with newest.
 */
export function matchTrainingNotes(
    messages: NoteMessage[],
    notes: TrainingTurnNote[],
): Map<number, TrainingTurnNote> {
    const matched = new Map<number, TrainingTurnNote>();
    if (notes.length === 0) return matched;
    const byId = new Map(notes.map((n) => [n.message_id, n]));
    const claimed = new Set<string>();
    const live: number[] = [];
    messages.forEach((m, index) => {
        if (m.role !== "user") return;
        const note = m.id ? byId.get(m.id) : undefined;
        if (note) {
            matched.set(index, note);
            claimed.add(note.id);
        } else if (m.attempt) {
            live.push(index);
        }
    });
    const spare = notes
        .filter((n) => !claimed.has(n.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const count = Math.min(live.length, spare.length);
    const liveTail = live.slice(live.length - count);
    const spareTail = spare.slice(spare.length - count);
    liveTail.forEach((messageIndex, k) => {
        matched.set(messageIndex, spareTail[k] as TrainingTurnNote);
    });
    return matched;
}
