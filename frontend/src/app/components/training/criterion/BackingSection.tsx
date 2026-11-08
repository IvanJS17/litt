"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { TrainingBackingCheck, TrainingPupilBackingWork } from "@mike/contracts";
import { getPupilBacking } from "@/app/lib/mikeApi";
import { CardsSkeleton, LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { BackingPanel } from "./BackingPanel";

// The mentor's section of the pupil's accountability checks (layer 3, card 8):
// every conclusion the pupil kept from their answers, the source LiTT could
// show for it, and what the pupil did with it («lo verifiqué», why they keep
// it). It is a section, not a tab: the «Criterio» tab that holds sections of
// this layer mounts it (supervision/CriterionTab.tsx). Learning data is shown as written and never
// translated; there are no totals across pupils and nothing ordered by how
// they did.

function summary(check: TrainingBackingCheck) {
    const conclusions = check.conclusions ?? [];
    const count = (status: string) => conclusions.filter((conclusion) => conclusion.status === status).length;
    return {
        total: conclusions.length,
        backed: count("backed"),
        unbacked: count("unbacked"),
        unverified: count("citation_unverified"),
    };
}

function Work({ work }: { work: TrainingPupilBackingWork }) {
    const t = useTranslations("training.criterion.backing.mentor");
    return (
        <li className="min-w-0 space-y-3 border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
            <div className="min-w-0">
                <p className="break-words text-sm font-medium text-gray-900">{work.title ?? t("untitled")}</p>
                <p className="text-xs text-gray-500">{t(`surface.${work.surface}`)}</p>
            </div>
            <ul className="space-y-3">
                {work.checks.map((check) => (
                    <li key={check.id} className="min-w-0">
                        <BackingPanel
                            check={check}
                            readOnly
                            heading={
                                <>
                                    <span className="block">
                                        {t("answerFrom", { date: new Date(check.created_at) })}
                                    </span>
                                    <span className="block text-xs font-normal text-gray-600">
                                        {t("summary", summary(check))}
                                    </span>
                                </>
                            }
                        />
                    </li>
                ))}
            </ul>
        </li>
    );
}

export function BackingSection({ orgId, traineeId }: { orgId: string; traineeId: string }) {
    const t = useTranslations("training.criterion.backing");
    const load = useCallback(() => getPupilBacking(orgId, traineeId), [orgId, traineeId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });
    const titleId = `backing-section-${traineeId}`;
    return (
        <section className="min-w-0 space-y-4" aria-labelledby={titleId}>
            <div className="space-y-0.5">
                <h3 id={titleId} className="text-sm font-medium text-gray-900">
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
                    {data.works.length === 0 ? (
                        <p className="text-sm text-gray-500">{t("mentor.empty")}</p>
                    ) : (
                        <ul className="space-y-4">
                            {data.works.map((work) => (
                                <Work key={`${work.surface}:${work.chat_id}`} work={work} />
                            ))}
                        </ul>
                    )}
                    {data.works_without_access > 0 && (
                        <p className="text-sm text-gray-500">
                            {t("mentor.withoutAccess", { count: data.works_without_access })}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
