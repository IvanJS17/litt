"use client";

import { useCallback, useEffect, useState } from "react";
import { markTrainingStageStale, useTrainingStageStale } from "@mike/ui";
import type { TrainingStage, TrainingTurnMode } from "@mike/contracts";
import { getTrainingStage } from "@/app/lib/mikeApi";

export { markTrainingStageStale };

/** What the composer needs to know about «Tu turno primero» where it is. */
export type TrainingTurnState = {
    /** The caller must write their own attempt before this turn. */
    attemptRequired: boolean;
    /**
     * The caller must also mark how sure they are of it (the thermometer).
     * False from a server that predates layer 3, which asks for no mark.
     */
    confidenceRequired: boolean;
    /** When the urgency pass that lifts it ends, if one is in force there. */
    urgencyPassExpiresAt: string | null;
    /** The caller's effective stage there; null for a lawyer, or while it is unknown. */
    stage?: TrainingStage | null;
    /**
     * Layer 3: the hints and counterparty round open now, counted by the
     * server from the chat's notes. Empty from a server that predates them,
     * and when no approach is owed.
     */
    modes: readonly TrainingTurnMode[];
    /** The rung the next hint would be, or null when the ladder is used up. */
    nextHintLevel: 1 | 2 | 3 | null;
    /** The turn of the round the next counterpart turn would be, or null when it is full. */
    counterpartNextStep: 1 | 2 | 3 | null;
};

const NOTHING_REQUIRED: TrainingTurnState = {
    attemptRequired: false,
    confidenceRequired: false,
    urgencyPassExpiresAt: null,
    stage: null,
    modes: [],
    nextHintLevel: null,
    counterpartNextStep: null,
};

// setTimeout's ceiling; a pass lasts at most 72 hours, well below it.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * LiTT training: whether a chat turn where the composer is (an organization,
 * and a project in it) needs the caller's attempt and thermometer mark, and the urgency pass that
 * lifts it there, if any, and, with the chat the turn continues, the hints and
 * the counterparty round open now. Only tells the composer what to show; the
 * server applies the same rule to the turn itself. While it is unknown, or if it
 * cannot be read, the composer behaves as today and the server's 400 asks for
 * the approach if one is needed. It reads again when the pass ends, when a
 * turn was refused for a missing approach or a mode, and when a turn ends
 * (`turnActive` goes from true to false): a hint moves the ladder one rung.
 */
export function useTrainingStage({
    orgId,
    projectId,
    chatId,
    turnActive = false,
    enabled = true,
}: {
    orgId?: string | null;
    projectId?: string | null;
    /** The chat the turn would continue; the ladder is counted from its notes. */
    chatId?: string | null;
    /** A turn of this composer's chat is running; the stage is read again when it ends. */
    turnActive?: boolean;
    enabled?: boolean;
}): TrainingTurnState {
    const [result, setResult] = useState<{
        scope: string;
        chatId: string | null;
        state: TrainingTurnState;
    } | null>(null);
    const [generation, setGeneration] = useState(0);
    const scope = `${orgId ?? ""}:${projectId ?? ""}`;
    const thisChat = chatId ?? null;
    const active = enabled && !!(orgId || projectId);
    const reload = useCallback(() => setGeneration((value) => value + 1), []);

    useEffect(() => {
        // A turn that just ended may have been a hint or a round turn: the
        // server counts again from the notes it wrote, so the stage is read
        // when `turnActive` goes back to false, and not while a turn runs.
        if (!active || turnActive) return;
        let cancelled = false;
        getTrainingStage({ orgId, projectId, chatId: thisChat }).then(
            (stage) => {
                if (!cancelled)
                    setResult({
                        scope,
                        chatId: thisChat,
                        state: {
                            attemptRequired: stage.attempt_required,
                            confidenceRequired: stage.confidence_required === true,
                            urgencyPassExpiresAt: stage.urgency_pass?.expires_at ?? null,
                            stage: stage.stage,
                            modes: stage.modes ?? [],
                            nextHintLevel: stage.next_hint_level ?? null,
                            counterpartNextStep: stage.counterpart_next_step ?? null,
                        },
                    });
            },
            () => {
                if (!cancelled)
                    setResult({ scope, chatId: thisChat, state: NOTHING_REQUIRED });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [active, turnActive, scope, thisChat, orgId, projectId, generation]);

    useTrainingStageStale(reload, active);

    // What «Tu turno primero» asks does not depend on the chat, so it stays on
    // screen while the chat changes (a new chat is given its id by its first
    // turn); the modes are counted per chat and wait for their own reading.
    const state =
        active && result?.scope === scope
            ? result.chatId === thisChat
                ? result.state
                : { ...result.state, modes: [], nextHintLevel: null, counterpartNextStep: null }
            : NOTHING_REQUIRED;
    const expiresAt = state.urgencyPassExpiresAt;

    // When the pass ends the field comes back without a refused turn first.
    useEffect(() => {
        if (!expiresAt) return;
        const wait = Date.parse(expiresAt) - Date.now();
        if (!Number.isFinite(wait)) return;
        const timer = setTimeout(reload, Math.min(Math.max(wait, 0) + 1000, MAX_TIMER_MS));
        return () => clearTimeout(timer);
    }, [expiresAt, reload]);

    return state;
}
