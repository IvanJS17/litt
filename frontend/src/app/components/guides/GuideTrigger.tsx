"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TrainingStage } from "@mike/contracts";
import { cn } from "@/app/lib/utils";
import { FeatureGuideModal } from "./FeatureGuideModal";
import type { GuideId } from "./guideCatalog";

export const GUIDE_TRIGGER_CLASS =
    "inline-flex min-h-8 items-center gap-1 rounded-sm text-sm font-medium text-gray-700 underline decoration-gray-400 underline-offset-4 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:min-h-11";

/**
 * «¿Qué es esto?» (or any label) beside a screen's title or inside an empty
 * state: a text button that opens that feature's guide. It never opens by
 * itself, and closing it (Esc, ×, the backdrop) returns focus to this button.
 */
export function GuideTrigger({
    id,
    label,
    initialStage,
    icon = true,
    className,
}: {
    id: GuideId;
    label?: string;
    initialStage?: TrainingStage;
    icon?: boolean;
    className?: string;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                aria-haspopup="dialog"
                data-guide-trigger={id}
                onClick={() => setOpen(true)}
                className={cn(GUIDE_TRIGGER_CLASS, className)}
            >
                {icon ? <CircleHelp aria-hidden="true" className="size-3.5" /> : null}
                {label ?? t("guides.ui.whatIsThis")}
            </button>
            <FeatureGuideModal id={id} open={open} onClose={() => setOpen(false)} initialStage={initialStage} />
        </>
    );
}
