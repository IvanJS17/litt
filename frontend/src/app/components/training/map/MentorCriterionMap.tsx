"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getPupilCriterion } from "@/app/lib/mikeApi";
import { LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { Block, CalibrationList, HintsLine, MapSkeleton, RetakeEntry, TopicList } from "./mapShared";

// The mentor's section «Mapa y calibración» of the «Criterio» tab: what the
// pupil's own map, calibration, hints and retakes say, read from the same
// route family as the pupil's (docs/training.md). Only the pupil's CURRENT
// mentor reads it, and only the notes and retakes of works in matters they can
// open (the rest are counted, never listed). It is evidence to weigh: counts of one person, no score,
// no comparison between pupils, and nothing ordered by how they did.

export function MentorCriterionMap({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.criterion.map");
    const load = useCallback(() => getPupilCriterion(orgId, pupilId), [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("mentor.actions.load"),
        operation: "training.manage",
    });
    const titleId = `mentor-map-${pupilId}`;
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
                <MapSkeleton />
            ) : (
                <div className="min-w-0 space-y-5">
                    <Block title={t("topics.title")}>
                        <TopicList topics={data.map.topics} />
                    </Block>
                    <Block title={t("calibration.title")}>
                        <CalibrationList calibration={data.calibration} />
                    </Block>
                    <Block title={t("hints.title")}>
                        <HintsLine requested={data.hints.requested} maxLevel={data.hints.max_level} mentor />
                    </Block>
                    <Block title={t("retakes.title")}>
                        {data.retakes.length > 0 ? (
                            <ul className="min-w-0 space-y-3">
                                {data.retakes.map((retake) => (
                                    <RetakeEntry key={retake.id} retake={retake} />
                                ))}
                            </ul>
                        ) : data.retakes_without_access === 0 ? (
                            <p className="text-sm text-gray-500">{t("retakes.noneMentor")}</p>
                        ) : null}
                        {/* Retakes the mentor cannot open exist: never "no retakes", only the count. */}
                        {data.retakes_without_access > 0 && (
                            <p className="text-sm text-gray-500">
                                {t("mentor.retakesWithoutAccess", { count: data.retakes_without_access })}
                            </p>
                        )}
                    </Block>
                    {data.notes_without_access > 0 && (
                        <p className="text-sm text-gray-500">
                            {t("mentor.withoutAccess", { count: data.notes_without_access })}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}
