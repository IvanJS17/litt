"use client";

import { CitationReviewHintUI } from "@mike/ui";
import { useTranslations } from "next-intl";

/** True when the automatic check put this citation in the low band. */
export function needsCitationReview(
    reviewRefs: readonly number[] | undefined,
    ref: number | undefined,
): boolean {
    return ref !== undefined && !!reviewRefs?.includes(ref);
}

/**
 * «Revisar esta cita» next to a citation whose stored band is the low one.
 * Nothing else is ever shown for a citation: no check mark, no «verified»
 * and no number for the other bands (docs/citation-support-check.md).
 */
export function CitationReviewHint({
    citationRef,
    className,
}: {
    citationRef?: number;
    className?: string;
}) {
    const t = useTranslations();
    return (
        <CitationReviewHintUI
            label={t("assistant.citationReview.label")}
            description={t("assistant.citationReview.description")}
            citationRef={citationRef}
            className={className}
        />
    );
}
