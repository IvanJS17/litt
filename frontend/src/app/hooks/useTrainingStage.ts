"use client";

import { useCallback, useEffect, useState } from "react";
import { markTrainingStageStale, useTrainingStageStale } from "@mike/ui";
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
};

const NOTHING_REQUIRED: TrainingTurnState = {
    attemptRequired: false,
    confidenceRequired: false,
    urgencyPassExpiresAt: null,
};

// setTimeout's ceiling; a pass lasts at most 72 hours, well below it.
const MAX_TIMER_MS = 2_147_483_647;

/**
 * LiTT training: whether a chat turn where the composer is (an organization,
 * and a project in it) needs the caller's attempt and thermometer mark, and the urgency pass that
 * lifts it there, if any. Only tells the composer what to show; the server
 * applies the same rule to the turn itself. While it is unknown, or if it
 * cannot be read, the composer behaves as today and the server's 400 asks for
 * the approach if one is needed. It reads again when the pass ends and when a
 * turn was refused for a missing approach.
 */
export function useTrainingStage({
    orgId,
    projectId,
    enabled = true,
}: {
    orgId?: string | null;
    projectId?: string | null;
    enabled?: boolean;
}): TrainingTurnState {
    const [result, setResult] = useState<{ key: string; state: TrainingTurnState } | null>(null);
    const [generation, setGeneration] = useState(0);
    const key = `${orgId ?? ""}:${projectId ?? ""}`;
    const active = enabled && !!(orgId || projectId);
    const reload = useCallback(() => setGeneration((value) => value + 1), []);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        getTrainingStage({ orgId, projectId }).then(
            (stage) => {
                if (!cancelled)
                    setResult({
                        key,
                        state: {
                            attemptRequired: stage.attempt_required,
                            confidenceRequired: stage.confidence_required === true,
                            urgencyPassExpiresAt: stage.urgency_pass?.expires_at ?? null,
                        },
                    });
            },
            () => {
                if (!cancelled) setResult({ key, state: NOTHING_REQUIRED });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [active, key, orgId, projectId, generation]);

    useTrainingStageStale(reload, active);

    const state = active && result?.key === key ? result.state : NOTHING_REQUIRED;
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
