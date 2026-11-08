"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { getMySupervision, listProjects } from "@/app/lib/mikeApi";
import { DefenseDetails, ReviewLines } from "./SupervisionDetails";
import { CardsSkeleton, LoadFailed, PassState, usePracticeLabel, useSupervisionData } from "./supervisionShared";

// Ajustes → Formación → Mi formación: «Lo que mi mentor ve de mí». Exactly
// what the pupil's current mentor reads about them in one organization (the
// server sends the same rows; questions and the note of a defense appear once
// its outcome is recorded, §4.7 of the approved specification).

export function MentorSeesMe({ orgId }: { orgId: string }) {
    const t = useTranslations("training");
    const practiceLabel = usePracticeLabel();
    const load = useCallback(async () => {
        const [supervision, projects] = await Promise.all([
            getMySupervision(orgId),
            listProjects().catch(() => []),
        ]);
        return { supervision, projects: new Map(projects.map((project) => [project.id, project.name])) };
    }, [orgId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("mentorSeesMe.actions.load"),
        operation: "training.read",
    });

    return (
        <section className="min-w-0 space-y-4" aria-labelledby={`mentor-sees-me-${orgId}`}>
            <div className="space-y-0.5">
                <h3 id={`mentor-sees-me-${orgId}`} className="text-sm font-medium text-gray-900">
                    {t("mentorSeesMe.title")}
                </h3>
                <p className="text-sm text-gray-500">{t("mentorSeesMe.intro")}</p>
            </div>
            {failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <CardsSkeleton rows={1} />
            ) : (
                <>
                    <Part title={t("mentorSeesMe.reviews")}>
                        {data.supervision.work_reviews.length === 0 ? (
                            <Empty>{t("mentorSeesMe.noReviews")}</Empty>
                        ) : (
                            data.supervision.work_reviews.map((review) => (
                                <li key={review.id} className="min-w-0 space-y-2 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                                    <p className="text-sm text-gray-500">{t(`surface.${review.surface}`)}</p>
                                    <ReviewLines review={review} />
                                </li>
                            ))
                        )}
                    </Part>
                    <Part title={t("mentorSeesMe.defenses")}>
                        {data.supervision.defenses.length === 0 ? (
                            <Empty>{t("mentorSeesMe.noDefenses")}</Empty>
                        ) : (
                            data.supervision.defenses.map((defense) => (
                                <li key={defense.id} className="min-w-0 space-y-2 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                                    <p className="break-words text-sm text-gray-900">{practiceLabel(defense.practice)}</p>
                                    <p className="text-sm text-gray-500">
                                        {t("defenses.createdOn", { date: new Date(defense.created_at) })}
                                    </p>
                                    {defense.outcome ? (
                                        <DefenseDetails defense={defense} />
                                    ) : (
                                        <p className="text-sm text-gray-700">{t("mentorSeesMe.scheduled")}</p>
                                    )}
                                </li>
                            ))
                        )}
                    </Part>
                    <Part title={t("mentorSeesMe.passes")}>
                        {data.supervision.urgency_passes.length === 0 ? (
                            <Empty>{t("mentorSeesMe.noPasses")}</Empty>
                        ) : (
                            data.supervision.urgency_passes.map((pass) => (
                                <li key={pass.id} className="min-w-0 space-y-0.5 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                                    <p className="break-words text-sm text-gray-900">
                                        {data.projects.get(pass.project_id) ?? t("passes.unknownProject")}
                                    </p>
                                    <p className="text-sm text-gray-700">
                                        <PassState pass={pass} />
                                    </p>
                                    <p className="text-sm text-gray-500">{t(`passes.reason.${pass.reason_code}`)}</p>
                                    {pass.reason_note && (
                                        <p className="whitespace-pre-wrap break-words text-sm text-gray-500">
                                            {pass.reason_note}
                                        </p>
                                    )}
                                </li>
                            ))
                        )}
                    </Part>
                </>
            )}
        </section>
    );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="min-w-0 space-y-2">
            <h4 className="text-sm font-medium text-gray-700">{title}</h4>
            <ul className="min-w-0 space-y-3">{children}</ul>
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <li className="text-sm text-gray-500">{children}</li>;
}
