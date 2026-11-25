"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
    trainingAttemptNextLine,
    trainingAttemptText,
    trainingCloseMessage,
    trainingConfidenceText,
    trainingModesText,
    trainingNeedsQuestionText,
    trainingNoteText,
    trainingUrgencyPassText,
    type TrainingTranslate,
} from "@mike/ui";

/**
 * LiTT training: the words of the shared training components (the approach
 * field, the thermometer, the private note, the urgency pass line) in the
 * user's language. The components live in packages/ui and take their text
 * from the host.
 */
export function useTrainingText() {
    const t = useTranslations();
    return useMemo(() => {
        const translate: TrainingTranslate = t;
        return {
            attempt: trainingAttemptText(translate),
            // Once the chat has a message: the approach for the NEXT question.
            attemptNext: trainingAttemptText(translate, { next: true }),
            attemptNextLine: trainingAttemptNextLine(translate),
            confidence: trainingConfidenceText(translate),
            modes: trainingModesText(translate),
            closeMessage: trainingCloseMessage(translate),
            needsQuestion: trainingNeedsQuestionText(translate),
            note: trainingNoteText(translate),
            urgencyPass: (expiresAt: string) => trainingUrgencyPassText(translate, expiresAt),
        };
    }, [t]);
}
