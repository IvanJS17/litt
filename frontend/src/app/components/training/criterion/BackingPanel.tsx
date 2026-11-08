"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { TrainingBackingCheck, TrainingBackingMark } from "@mike/contracts";
import { BackingPanelUI, buildBackingLabels, type BackingTranslate } from "@mike/ui";
import type { WebTrainingBacking } from "@/app/hooks/useWebTrainingBacking";

/** The panel's texts in the person's language (catalog `training.criterion.backing`). */
export function useBackingLabels() {
    const t = useTranslations();
    return buildBackingLabels(t as unknown as BackingTranslate);
}

/** One answer's accountability panel, in the web app. */
export function BackingPanel({
    check,
    onMark,
    readOnly = false,
    className,
    heading,
}: {
    check: TrainingBackingCheck;
    onMark?: (check: TrainingBackingCheck, conclusionId: string, mark: TrainingBackingMark) => Promise<void>;
    readOnly?: boolean;
    className?: string;
    heading?: ReactNode;
}) {
    const labels = useBackingLabels();
    return (
        <BackingPanelUI
            check={check}
            labels={labels}
            readOnly={readOnly}
            className={className}
            heading={heading}
            onMark={onMark ? (conclusionId, mark) => onMark(check, conclusionId, mark) : undefined}
        />
    );
}

/**
 * Under an assistant message: its check, when the server wrote one for it.
 * Nothing for a message without an id yet (a streaming answer) or without a
 * check (a short answer, or the caller is not a junior).
 */
export function BackingSlot({
    backing,
    messageId,
    className,
}: {
    backing: WebTrainingBacking;
    messageId: string | undefined;
    className?: string;
}) {
    const check = messageId ? backing.checks.get(messageId) : undefined;
    if (!check) return null;
    return <BackingPanel check={check} onMark={backing.mark} className={className} />;
}
