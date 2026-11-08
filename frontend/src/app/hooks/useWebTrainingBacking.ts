"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { TrainingBackingCheck, TrainingBackingMark } from "@mike/contracts";
import { useTrainingBacking } from "@mike/ui";
import { useWorkspaceOrgId } from "@/app/contexts/WorkspaceContext";
import { useTrainingStage } from "@/app/hooks/useTrainingStage";
import { getChatBacking, markBackingConclusion } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/**
 * LiTT training, «Modo de rendir cuentas»: the accountability checks of the
 * chat's answers, for a junior only (the server writes them for nobody else,
 * so nobody else asks). The org and the project are where the turn runs, as
 * for the composer's stage.
 */
export function useWebTrainingBacking({
    chatId,
    projectId,
    isResponseLoading,
}: {
    chatId: string | null | undefined;
    projectId?: string | null;
    isResponseLoading: boolean;
}) {
    const t = useTranslations("training.criterion.backing");
    const orgId = useWorkspaceOrgId();
    const { stage } = useTrainingStage({ orgId, projectId, enabled: !!chatId });
    const backing = useTrainingBacking({
        chatId,
        enabled: stage === "junior",
        isResponseLoading,
        load: getChatBacking,
        save: markBackingConclusion,
    });
    const { mark: markShared } = backing;
    const mark = useCallback(
        async (check: TrainingBackingCheck, conclusionId: string, change: TrainingBackingMark) => {
            try {
                await markShared(check, conclusionId, change);
            } catch (error) {
                notifyError(error, { action: t("actions.save"), operation: "training.read" });
                throw error;
            }
        },
        [markShared, t],
    );
    return { checks: backing.checks, mark };
}

export type WebTrainingBacking = ReturnType<typeof useWebTrainingBacking>;
