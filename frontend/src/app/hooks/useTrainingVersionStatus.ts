"use client";

import { useCallback, useEffect, useState } from "react";
import { listDocumentVersions } from "@/app/lib/mikeApi";

/** `unknown` while loading or when the status cannot be read. */
export type TrainingRelease = "unknown" | "held" | "released";

export type TrainingVersionStatus = {
    /** The version the status is about: the one asked for, else the current one. */
    versionId: string | null;
    release: TrainingRelease;
    canApprove: boolean;
    refresh: () => void;
};

/**
 * LiTT training (docs/training.md): whether the version a viewer shows is a
 * pasante's draft that may not leave LiTT, and whether the caller may
 * approve it. The viewer offers its download only once the version is known
 * to be `released`: that download reads `/file`, which stays open for viewing.
 */
export function useTrainingVersionStatus(
    documentId: string | null,
    versionId: string | null,
    enabled = true,
): TrainingVersionStatus {
    const active = enabled && !!documentId;
    const key = `${documentId ?? ""}:${versionId ?? ""}`;
    const [state, setState] = useState<{
        key: string;
        versionId: string | null;
        release: TrainingRelease;
        canApprove: boolean;
    } | null>(null);
    const [generation, setGeneration] = useState(0);

    useEffect(() => {
        if (!active || !documentId) return;
        let cancelled = false;
        listDocumentVersions(documentId).then(
            ({ current_version_id, versions }) => {
                if (cancelled) return;
                const targetId = versionId ?? current_version_id;
                const version = versions.find((item) => item.id === targetId);
                setState({
                    key,
                    versionId: version?.id ?? versionId,
                    release: !version
                        ? "unknown"
                        : version.training_held === true
                          ? "held"
                          : "released",
                    canApprove: version?.training_can_approve === true,
                });
            },
            () => {
                if (!cancelled)
                    setState({ key, versionId, release: "unknown", canApprove: false });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [active, documentId, versionId, key, generation]);

    const refresh = useCallback(() => setGeneration((value) => value + 1), []);
    if (!active) return { versionId, release: "released", canApprove: false, refresh };
    const known = state?.key === key ? state : null;
    return {
        versionId: known?.versionId ?? versionId,
        release: known?.release ?? "unknown",
        canApprove: known?.canApprove ?? false,
        refresh,
    };
}
