"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getPupilCriteriaContrasts } from "@/app/lib/mikeApi";
import { CardsSkeleton, LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { ComparisonSections, RouteCaption } from "./contrastShared";

// The mentor's section «Contrastes de criterios» (docs/training.md, layer 3):
// what the pupil wrote about why two analyses of the same case diverge, and
// how it compared with the AI's explanation. Only the pupil's current mentor
// reads it, and only for works in matters they can open (the others are
// counted, never shown). The two analyses stay in the pupil's chat. It is
// evidence for the mentor to weigh, with no score and no comparison between
// pupils.
//
// A section of the panel's «Criterio» tab: mount it as
// <MentorCriteriaContrasts orgId={…} pupilId={…} /> where that tab collects its sections.

export function MentorCriteriaContrasts({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.criterion.contrast");
    const load = useCallback(() => getPupilCriteriaContrasts(orgId, pupilId), [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.loadMentor"),
        operation: "training.manage",
    });
    const heading = `mentor-criteria-contrasts-${pupilId}`;

    return (
        <section className="min-w-0 space-y-4" aria-labelledby={heading}>
            <div className="space-y-0.5">
                <h3 id={heading} className="text-sm font-medium text-gray-900">
                    {t("mentor.title")}
                </h3>
                <p className="text-sm text-gray-500">{t("mentor.intro")}</p>
            </div>
            {failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <CardsSkeleton rows={1} />
            ) : (
                <>
                    {data.contrasts.length === 0 && <p className="text-sm text-gray-500">{t("mentor.empty")}</p>}
                    <ul className="min-w-0 space-y-4">
                        {data.contrasts.map((contrast) => (
                            <li
                                key={contrast.id}
                                className="min-w-0 space-y-3 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                            >
                                <div className="space-y-0.5 text-sm">
                                    <p className="font-medium text-gray-900">{t(`card.status.${contrast.status}`)}</p>
                                    <p className="text-gray-500">{t("card.created", { date: new Date(contrast.created_at) })}</p>
                                    {contrast.title && <p className="break-words text-gray-500">{contrast.title}</p>}
                                </div>
                                <div className="min-w-0 space-y-1">
                                    <p className="text-xs text-gray-500">{t("mentor.routes")}</p>
                                    {contrast.routes.map((route, index) => (
                                        <RouteCaption key={index} route={route} />
                                    ))}
                                </div>
                                {contrast.person_explanation ? (
                                    <div className="min-w-0 space-y-1">
                                        <h4 className="text-sm font-medium text-gray-900">{t("mentor.yourExplanation")}</h4>
                                        <p className="whitespace-pre-wrap break-words text-sm text-gray-800">
                                            {contrast.person_explanation}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">
                                        {contrast.status === "failed" ? t("mentor.failed") : t("mentor.awaiting")}
                                    </p>
                                )}
                                {contrast.comparison && (
                                    <ComparisonSections comparison={contrast.comparison} idPrefix={`mentor-${contrast.id}`} />
                                )}
                            </li>
                        ))}
                    </ul>
                    {data.contrasts_without_access > 0 && (
                        <p className="text-sm text-gray-500">
                            {t("mentor.hidden", { count: data.contrasts_without_access })}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
