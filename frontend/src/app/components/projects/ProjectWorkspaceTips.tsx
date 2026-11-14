"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { PIXEL_TEXT_CLASS } from "@mike/ui";

const PROJECT_WORKSPACE_TIP_COUNT = 5;

export function ProjectWorkspaceTips() {
    const t = useTranslations();
    const PROJECT_WORKSPACE_TIPS = [
        t("projects.tips.dragAndDrop"),
        t("projects.tips.explainPassage"),
        t("projects.tips.editDocument"),
        t("projects.tips.createDocument"),
        t("projects.tips.replicateDocument"),
    ];
    const [tipIndex, setTipIndex] = useState(0);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- randomising after mount avoids a server/client hydration mismatch
        setTipIndex(Math.floor(Math.random() * PROJECT_WORKSPACE_TIP_COUNT));
    }, []);

    function rotateTip(direction: -1 | 1) {
        setTipIndex(
            (current) =>
                (current + direction + PROJECT_WORKSPACE_TIP_COUNT) %
                PROJECT_WORKSPACE_TIP_COUNT,
        );
    }

    return (
        <div className="inline-flex max-w-xl flex-col items-center gap-2 text-gray-600">
            <p
                aria-live="polite"
                className="min-w-0 rounded-full bg-app-surface px-4 py-2 text-xs"
            >
                <strong>{t("projects.tip")}</strong> {PROJECT_WORKSPACE_TIPS[tipIndex]}
            </p>
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    aria-label={t("projects.previousTip")}
                    onClick={() => rotateTip(-1)}
                    className="flex h-6 w-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-app-surface-active/50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
                <span
                    aria-label={t("projects.tipNOfTotal", { n: tipIndex + 1, total: PROJECT_WORKSPACE_TIP_COUNT })}
                    className={`min-w-8 text-center tabular-nums text-gray-500 ${PIXEL_TEXT_CLASS}`}
                >
                    {tipIndex + 1}/{PROJECT_WORKSPACE_TIP_COUNT}
                </span>
                <button
                    type="button"
                    aria-label={t("projects.nextTip")}
                    onClick={() => rotateTip(1)}
                    className="flex h-6 w-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-app-surface-active/50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
