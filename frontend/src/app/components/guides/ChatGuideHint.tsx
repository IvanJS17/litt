"use client";

import { useTranslations } from "next-intl";
import { GuideHint } from "./GuideHint";
import { useMyTrainingStage } from "./useMyTrainingStage";

/**
 * The first-time notice above the composer: the chat guide for everyone, or
 * the pupil guide (open on their stage) for someone in training; each once,
 * per person. Nothing shows until the stage is known, so it never flickers.
 */
export function ChatGuideHint({ className }: { className?: string }) {
    const t = useTranslations();
    const training = useMyTrainingStage();
    if (!training.loaded) return null;
    return training.stage ? (
        <GuideHint
            hint={`role:${training.stage}`}
            guide="pupil"
            initialStage={training.stage}
            message={t("guides.ui.hintPupil")}
            className={className}
        />
    ) : (
        <GuideHint hint="chat" guide="chat" message={t("guides.ui.hintChat")} className={className} />
    );
}
