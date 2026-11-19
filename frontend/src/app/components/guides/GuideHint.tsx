"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TrainingStage } from "@mike/contracts";
import { cn } from "@/app/lib/utils";
import type { GuideId } from "./guideCatalog";
import { GuideTrigger } from "./GuideTrigger";
import { useDismissedHint } from "./useDismissedHint";

/**
 * A first-time notice above a screen that is never empty (the Radar, the
 * chat, the composer): one sentence, the guide's button and a × that closes it
 * for good (per person; see `useDismissedHint`). `hint` names what was seen
 * (`radar`, `chat`, `role:pasante`), so a new stage shows its own notice.
 */
export function GuideHint({
    hint,
    guide,
    message,
    initialStage,
    className,
}: {
    hint: string;
    guide: GuideId;
    message: string;
    initialStage?: TrainingStage;
    className?: string;
}) {
    const t = useTranslations();
    const { dismissed, dismiss } = useDismissedHint(hint);
    if (dismissed) return null;
    return (
        <div
            role="note"
            data-guide-hint={hint}
            className={cn(
                "flex items-start gap-2 border-l-2 border-[var(--litt-note-rule)] py-0.5 pl-3",
                className,
            )}
        >
            <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm text-gray-700">{message}</p>
                <GuideTrigger id={guide} initialStage={initialStage} />
            </div>
            <button
                type="button"
                aria-label={t("guides.ui.hintDismiss")}
                onClick={() => {
                    dismiss();
                    // The hint is gone: focus moves to the guide's button beside the title.
                    window.requestAnimationFrame(() =>
                        document.querySelector<HTMLElement>(`[data-guide-trigger="${guide}"]`)?.focus(),
                    );
                }}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:size-11"
            >
                <X aria-hidden="true" className="size-4" />
            </button>
        </div>
    );
}
