"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
    trainingAttemptText,
    trainingConfidenceText,
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
            confidence: trainingConfidenceText(translate),
            note: trainingNoteText(translate),
            urgencyPass: (expiresAt: string) => trainingUrgencyPassText(translate, expiresAt),
        };
    }, [t]);
}
