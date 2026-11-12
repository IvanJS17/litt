"use client";

import type { ReactElement } from "react";
import { TextQuote, X } from "lucide-react";
import { LIQUID_GLASS_FLAT_CLASS } from "./LiquidGlassUI";
import type { MessageExcerpt } from "@mike/client";
import { useTranslations } from "use-intl";

/** What a pill calls an excerpt: it names the kind, not the passage. */
export function excerptLabel(
    excerpt: MessageExcerpt,
    t: (key: "ui.excerptPill.annotatedExcerpt" | "ui.excerptPill.excerpt") => string,
): string {
    return excerpt.note ? t("ui.excerptPill.annotatedExcerpt") : t("ui.excerptPill.excerpt");
}

/**
 * The pill for a passage quoted from an assistant response, in the composer
 * (with `onRemove`) and in a sent message (without). Clicking it opens the
 * passage; the pill looks the same with or without a note.
 */
export function ExcerptPillUI({
    excerpt,
    onOpen,
    onRemove,
}: {
    excerpt: MessageExcerpt;
    onOpen: () => void;
    onRemove?: () => void;
}): ReactElement {
    const t = useTranslations();
    const preview = excerpt.text.slice(0, 60);
    return (
        <div
            className={`inline-flex max-w-full items-center rounded-[10px] text-xs text-gray-800 ${LIQUID_GLASS_FLAT_CLASS}`}
        >
            <button
                type="button"
                onClick={onOpen}
                aria-label={t("ui.excerptPill.viewExcerptPreview", { preview })}
                className={`inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-[10px] py-0.5 pl-2 transition-colors hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                    onRemove ? "" : "pr-2.5"
                }`}
            >
                <TextQuote aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
                <span>{excerptLabel(excerpt, t)}</span>
            </button>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={t("ui.excerptPill.removeExcerptPreview", { preview })}
                    className="mx-1 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-gray-900/5 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <X aria-hidden="true" className="h-2.5 w-2.5" />
                </button>
            )}
        </div>
    );
}
