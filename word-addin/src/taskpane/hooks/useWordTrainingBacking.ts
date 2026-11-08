import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { TrainingBackingCheck, TrainingBackingMark } from "@mike/contracts";
import { useTrainingBacking } from "@mike/ui";
import { getChatBacking, getWordTrainingStage, markBackingConclusion } from "../api/client";
import { notifyError } from "../lib/notify";

/**
 * LiTT training, «Modo de rendir cuentas»: the accountability checks of a Word
 * chat's answers, for a junior only. A device-only chat keeps no transcript
 * on the server, so it has no checks to read.
 */
export function useWordTrainingBacking({
  chatId,
  storage,
  isResponseLoading,
}: {
  chatId: string | null | undefined;
  storage: "cloud" | "local";
  isResponseLoading: boolean;
}) {
  const t = useTranslations();
  const [junior, setJunior] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getWordTrainingStage().then(
      (stage) => {
        if (!cancelled) setJunior(stage === "junior");
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  const backing = useTrainingBacking({
    chatId,
    enabled: junior && storage === "cloud",
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
        notifyError(error, {
          action: t("training.criterion.backing.actions.save"),
          page: "Assistant",
          operation: "training.read",
        });
        throw error;
      }
    },
    [markShared, t],
  );
  return { checks: backing.checks, mark };
}

export type WordTrainingBacking = ReturnType<typeof useWordTrainingBacking>;
