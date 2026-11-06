"use client";

import { useEffect, useState } from "react";
import { getTrainingStage, type TrainingStage } from "@/app/lib/mikeApi";

/**
 * LiTT training: the caller's effective stage where a chat turn would run
 * (an organization, and a project in it). Only tells the composer what to
 * show; the server applies the same rule to the turn itself. While it is
 * unknown, or if it cannot be read, the composer behaves as today and the
 * server's 400 asks for the approach if one is needed.
 */
export function useTrainingStage({
    orgId,
    projectId,
    enabled = true,
}: {
    orgId?: string | null;
    projectId?: string | null;
    enabled?: boolean;
}): TrainingStage | null {
    const [result, setResult] = useState<{ key: string; stage: TrainingStage | null } | null>(null);
    const key = `${orgId ?? ""}:${projectId ?? ""}`;
    const active = enabled && !!(orgId || projectId);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        getTrainingStage({ orgId, projectId }).then(
            (stage) => {
                if (!cancelled) setResult({ key, stage });
            },
            () => {
                if (!cancelled) setResult({ key, stage: null });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [active, key, orgId, projectId]);

    return active && result?.key === key ? result.stage : null;
}
