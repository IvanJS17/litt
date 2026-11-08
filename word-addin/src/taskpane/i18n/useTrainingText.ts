import { useMemo } from "react";
import { useTranslations } from "use-intl";
import {
  trainingAttemptText,
  trainingCloseMessage,
  trainingConfidenceText,
  trainingModesText,
  trainingNeedsQuestionText,
  trainingNoteText,
  type TrainingTranslate,
} from "@mike/ui";

/**
 * LiTT training: the words of the shared training components (the approach
 * field, the thermometer, the private note) in the pane's language. The
 * components live in packages/ui and take their text from the host.
 */
export function useTrainingText() {
  const t = useTranslations();
  return useMemo(() => {
    const translate: TrainingTranslate = t;
    return {
      attempt: trainingAttemptText(translate),
      confidence: trainingConfidenceText(translate),
      modes: trainingModesText(translate),
      closeMessage: trainingCloseMessage(translate),
      needsQuestion: trainingNeedsQuestionText(translate),
      note: trainingNoteText(translate),
    };
  }, [t]);
}
