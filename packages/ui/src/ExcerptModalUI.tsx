"use client";

import type { ReactElement } from "react";
import { ModalUI } from "./ModalUI";
import { TextSlabUI } from "./TextSlabUI";
import { excerptLabel } from "./ExcerptPillUI";
import type { MessageExcerpt } from "@mike/client";
import { useTranslations } from "use-intl";

const LABEL_CLASS = "mb-2 text-sm font-medium text-gray-700";

/**
 * The full text behind an excerpt pill: the quoted passage and, when the
 * reader annotated it, their note.
 */
export function ExcerptModalUI({
    excerpt,
    onClose,
}: {
    /** Null keeps the modal closed. */
    excerpt: MessageExcerpt | null;
    onClose: () => void;
}): ReactElement {
    const t = useTranslations();
    const title = excerpt ? excerptLabel(excerpt, t) : t("ui.excerptPill.excerpt");
    return (
        <ModalUI
            open={!!excerpt}
            onClose={onClose}
            size="sm"
            className="h-auto"
            breadcrumbs={[t("ui.excerptModal.assistant"), title]}
            ariaLabel={title}
        >
            {excerpt && (
                <div className="flex flex-col gap-4 pb-5">
                    <div>
                        <p className={LABEL_CLASS}>{t("ui.excerptModal.excerpt")}</p>
                        {/* Long passages scroll inside the slab; focusable so
                            the scroll is reachable by keyboard. */}
                        <TextSlabUI
                            tabIndex={0}
                            className="max-h-60 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                            <p className="whitespace-pre-wrap break-words font-serif text-sm leading-6 text-gray-600">
                                {excerpt.text}
                            </p>
                        </TextSlabUI>
                    </div>
                    {excerpt.note && (
                        <div>
                            <p className={LABEL_CLASS}>{t("ui.excerptModal.annotation")}</p>
                            <p className="break-words text-sm text-gray-900">
                                {excerpt.note}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </ModalUI>
    );
}
