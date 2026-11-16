"use client";

import { useId, type ReactElement } from "react";
import { twMerge } from "tailwind-merge";

export type CitationReviewHintUIProps = {
    /** The visible words: «Revisar esta cita». */
    label: string;
    /** What the hint means, for assistive technology and the tooltip. */
    description: string;
    /** The citation's number, so each hint names the citation it is about. */
    citationRef?: number;
    className?: string;
};

/**
 * A discreet plain-text hint next to a citation whose automatic support check
 * came back in the low band. It says only «check this citation»: never a
 * score, and nothing at all is drawn for any other band (the caller does not
 * render it). Plain text in the warning tone, not a pill badge. Shared by the
 * web app and the Word add-in.
 */
export function CitationReviewHintUI({
    label,
    description,
    citationRef,
    className,
}: CitationReviewHintUIProps): ReactElement {
    const descriptionId = useId();
    return (
        <span
            data-citation-review-hint={citationRef ?? "true"}
            title={description}
            aria-describedby={descriptionId}
            className={twMerge(
                "mx-1 whitespace-nowrap font-sans text-[0.7rem] font-normal leading-none text-warning",
                className,
            )}
        >
            {label}
            <span id={descriptionId} className="sr-only">
                {description}
            </span>
        </span>
    );
}
