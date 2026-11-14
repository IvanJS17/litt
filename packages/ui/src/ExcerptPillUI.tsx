"use client";

import type { ReactElement } from "react";
import { TextQuote } from "lucide-react";
import type { MessageExcerpt } from "@mike/client";
import { useTranslations } from "use-intl";
import { AttachmentChipUI } from "./ComposerChipsUI";

/** What a pill calls an excerpt: it names the kind, not the passage. */
export function excerptLabel(
    excerpt: MessageExcerpt,
    t: (key: "ui.excerptPill.annotatedExcerpt" | "ui.excerptPill.excerpt") => string,
): string {
    return excerpt.note ? t("ui.excerptPill.annotatedExcerpt") : t("ui.excerptPill.excerpt");
}

/**
 * The label for a passage quoted from an assistant response, in the composer
 * (with `onRemove`) and in a sent message (without). It is an attachment, so
 * it wears the same soft sheet as a document. Clicking it opens the passage;
 * it looks the same with or without a note.
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
        <AttachmentChipUI
            name={excerptLabel(excerpt, t)}
            icon={<TextQuote />}
            onOpen={onOpen}
            openLabel={t("ui.excerptPill.viewExcerptPreview", { preview })}
            onRemove={onRemove}
            removeLabel={t("ui.excerptPill.removeExcerptPreview", { preview })}
        />
    );
}
