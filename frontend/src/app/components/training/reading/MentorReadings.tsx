"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getPupilReadings } from "@/app/lib/mikeApi";
import { CardsSkeleton, LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { ReadingResult, useReadingStatusLabel } from "./readingShared";

// The mentor's section «Lecturas completas» (docs/training.md, layer 3): what
// a pupil found on their own, and what the machine found, per reading. Only
// the pupil's current mentor reads it, and only for documents in matters they
// can open (the others are counted, never shown). It is evidence for the
// mentor to weigh, with no score and no comparison between pupils.
//
// A section of the panel's «Criterio» tab: mount it as
// <MentorReadings orgId={…} pupilId={…} /> where that tab collects its sections.

export function MentorReadings({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.criterion.reading");
    const statusLabel = useReadingStatusLabel();
    const load = useCallback(() => getPupilReadings(orgId, pupilId), [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });

    return (
        <section className="min-w-0 space-y-4" aria-labelledby={`mentor-readings-${pupilId}`}>
            <div className="space-y-0.5">
                <h3 id={`mentor-readings-${pupilId}`} className="text-sm font-medium text-gray-900">
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
                    {data.readings.length === 0 && <p className="text-sm text-gray-500">{t("mentor.empty")}</p>}
                    <ul className="min-w-0 space-y-4">
                        {data.readings.map((reading) => (
                            <li
                                key={reading.id}
                                className="min-w-0 space-y-3 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                            >
                                <div className="space-y-0.5 text-sm">
                                    <p className="font-medium text-gray-900">{statusLabel(reading.status)}</p>
                                    <p className="text-gray-500">
                                        {reading.submitted_at
                                            ? t("mentor.sentOn", { date: new Date(reading.submitted_at) })
                                            : t("mentor.started", { date: new Date(reading.created_at) })}
                                    </p>
                                    {reading.model && (
                                        <p className="break-words text-gray-500">{t("mentor.model", { model: reading.model })}</p>
                                    )}
                                </div>
                                {reading.findings ? (
                                    <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{reading.findings}</p>
                                ) : (
                                    <p className="text-sm text-gray-500">{t("mentor.notSent")}</p>
                                )}
                                {reading.status === "compared" && <ReadingResult reading={reading} />}
                            </li>
                        ))}
                    </ul>
                    {data.readings_without_access > 0 && (
                        <p className="text-sm text-gray-500">{t("mentor.hidden", { count: data.readings_without_access })}</p>
                    )}
                </>
            )}
        </section>
    );
}
