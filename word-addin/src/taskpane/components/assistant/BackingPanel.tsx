import React from "react";
import { useTranslations } from "use-intl";
import type { TrainingBackingCheck } from "@mike/contracts";
import { BackingPanelUI, buildBackingLabels, type BackingTranslate } from "@mike/ui";
import type { WordTrainingBacking } from "../../hooks/useWordTrainingBacking";

/**
 * Under a junior's assistant message in Word: the conclusions of that answer
 * and the source LiTT could show for each (the catalog is the web app's,
 * `training.criterion.backing`). Nothing for a message without a check.
 */
export function BackingSlot({
  backing,
  messageId,
}: {
  backing: WordTrainingBacking | undefined;
  messageId: string;
}): React.ReactElement | null {
  const t = useTranslations();
  const check: TrainingBackingCheck | undefined = backing?.checks.get(messageId);
  if (!backing || !check) return null;
  return (
    <BackingPanelUI
      check={check}
      labels={buildBackingLabels(t as unknown as BackingTranslate)}
      onMark={(conclusionId, mark) => backing.mark(check, conclusionId, mark)}
    />
  );
}
