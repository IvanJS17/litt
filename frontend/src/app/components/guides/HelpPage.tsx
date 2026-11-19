"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { FeatureGuideModal } from "./FeatureGuideModal";
import { FEATURE_GUIDE_IDS, ROLE_GUIDE_IDS, type GuideId } from "./guideCatalog";
import { useGuide } from "./FeatureGuideModal";
import { useMyTrainingStage } from "./useMyTrainingStage";

function GuideRow({ id, onOpen }: { id: GuideId; onOpen: (id: GuideId) => void }) {
    const t = useTranslations();
    const guide = useGuide(id);
    return (
        <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6" data-guide-row={id}>
            <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-900">{guide.title}</h3>
                <p className="mt-0.5 max-w-prose text-sm text-gray-700">{guide.summary}</p>
            </div>
            <PillButtonUI
                tone="white"
                size="sm"
                aria-haspopup="dialog"
                aria-label={`${t("guides.ui.openGuide")}: ${guide.title}`}
                className="min-h-8 shrink-0 self-start pointer-coarse:min-h-11"
                onClick={() => onOpen(id)}
            >
                {t("guides.ui.openGuide")}
            </PillButtonUI>
        </li>
    );
}

/**
 * Ayuda (`/help`): every feature guide and the two role guides, always in the
 * same place (the sidebar). The guides open here and nowhere on their own.
 */
export function HelpPage() {
    const t = useTranslations();
    const [open, setOpen] = useState<GuideId | null>(null);
    const training = useMyTrainingStage();
    return (
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:px-8">
            <header className="space-y-1">
                <h1 className="font-serif text-2xl text-gray-900">{t("guides.ui.helpTitle")}</h1>
                <p className="text-sm text-gray-700">{t("guides.ui.helpIntro")}</p>
            </header>
            <section aria-labelledby="help-features" className="space-y-1">
                <h2 id="help-features" className="font-serif text-lg text-gray-900">
                    {t("guides.ui.helpFeatures")}
                </h2>
                <ul className="divide-y divide-gray-200">
                    {FEATURE_GUIDE_IDS.map((id) => (
                        <GuideRow key={id} id={id} onOpen={setOpen} />
                    ))}
                </ul>
            </section>
            <section aria-labelledby="help-roles" className="space-y-1">
                <h2 id="help-roles" className="font-serif text-lg text-gray-900">
                    {t("guides.ui.helpRoles")}
                </h2>
                <ul className="divide-y divide-gray-200">
                    {ROLE_GUIDE_IDS.map((id) => (
                        <GuideRow key={id} id={id} onOpen={setOpen} />
                    ))}
                </ul>
            </section>
            {open ? (
                <FeatureGuideModal
                    id={open}
                    open
                    onClose={() => setOpen(null)}
                    initialStage={open === "pupil" ? (training.stage ?? undefined) : undefined}
                />
            ) : null}
        </div>
    );
}
