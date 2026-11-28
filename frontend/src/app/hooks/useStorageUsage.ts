"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { StorageUsage } from "@mike/contracts";
import { getOrgStorageUsage, getUserStorageUsage } from "@/app/lib/mikeApi";
import { reportFault, type UserFacingError } from "@/app/lib/userFacingError";

export type StorageUsageState =
    | { status: "loading" }
    | { status: "loaded"; usage: StorageUsage }
    | { status: "failed"; error: UserFacingError };

/**
 * Reads the use of a storage space: a firm's when given its id, otherwise the
 * signed-in person's own. A failed read is described for the person (never the
 * raw error) and `retry` reads again. Leaving the screen cancels the read.
 */
export function useStorageUsage(orgId?: string): {
    state: StorageUsageState;
    retry: () => void;
} {
    const t = useTranslations();
    const [state, setState] = useState<StorageUsageState>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const action = t("settings.storage.loadAction");

    useEffect(() => {
        const controller = new AbortController();
        const read = orgId === undefined
            ? getUserStorageUsage(controller.signal)
            : getOrgStorageUsage(orgId, controller.signal);
        read.then(
            (usage) => {
                if (!controller.signal.aborted) setState({ status: "loaded", usage });
            },
            (error: unknown) => {
                // A read that was cancelled has nobody left to tell.
                if (controller.signal.aborted) return;
                setState({
                    status: "failed",
                    error: reportFault(error, { action, operation: "storage.usage" }),
                });
            },
        );
        return () => controller.abort();
    }, [orgId, attempt, action]);

    const retry = useCallback(() => {
        setState({ status: "loading" });
        setAttempt((current) => current + 1);
    }, []);

    return { state, retry };
}
