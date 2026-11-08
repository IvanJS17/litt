"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import type {
    TrainingCalibration,
    TrainingMapTopic,
    TrainingRetake,
    TrainingVerdictValue,
} from "@/app/lib/mikeApi";

// Pieces shared by «Mi criterio» (Mi formación) and the mentor's map section
// (docs/training.md, «Own map, calibration and retake»). Everything here is
// a count of one person's own events: no score, average, percentage, ranking
// or comparison. State is always text, never carried by color. Topics, the
// question, the answer and the contrast are learning data: shown as the
// server sends them and never translated.

/** The thermometer's four levels, by the number the server sends. */
const LEVEL_KEY = { 1: "guess", 2: "doubt", 3: "fairlySure", 4: "sure" } as const;

/** The loading state of a map, in the layout of the final one. */
export function MapSkeleton() {
    const t = useTranslations("common");
    return (
        <div className="min-w-0 space-y-5" aria-busy="true" aria-label={t("loading")}>
            {[3, 2, 1, 2].map((lines, block) => (
                <div key={block} className="min-w-0 space-y-2">
                    <SkeletonLine className="w-1/3" />
                    {Array.from({ length: lines }, (_, line) => (
                        <SkeletonLine key={line} className={line % 2 ? "w-2/3" : "w-5/6"} />
                    ))}
                </div>
            ))}
        </div>
    );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="min-w-0 space-y-2">
            <h4 className="text-sm font-medium text-gray-900">{title}</h4>
            {children}
        </div>
    );
}

export function TopicList({
    topics,
    action,
}: {
    topics: TrainingMapTopic[];
    /** What goes at the end of a topic that is due for a retake. */
    action?: (topic: TrainingMapTopic) => ReactNode;
}) {
    const t = useTranslations("training.criterion.map.topics");
    if (topics.length === 0) return <p className="text-sm text-gray-500">{t("empty")}</p>;
    return (
        <ul className="min-w-0 space-y-3">
            {topics.map((topic) => (
                <li
                    key={topic.key}
                    className="min-w-0 space-y-1 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0"
                >
                    <p className="break-words text-sm font-medium text-gray-900">{topic.label}</p>
                    <p className="text-sm text-gray-700">
                        {t(`state.${topic.state}`)}
                        {topic.state !== "few_data" &&
                            ` · ${t("window", { hits: topic.window_hits, size: topic.window_size })}`}
                    </p>
                    <p className="text-sm text-gray-500">
                        {t("events", { count: topic.events })} · {t("last", { date: new Date(topic.last_at) })}
                    </p>
                    {topic.retake_due && <p className="text-sm text-gray-700">{t("due")}</p>}
                    {action?.(topic)}
                </li>
            ))}
        </ul>
    );
}

export function CalibrationList({ calibration }: { calibration: TrainingCalibration }) {
    const t = useTranslations("training.criterion.map.calibration");
    const levels = useTranslations("training.criterion.turn.confidenceLevels");
    if (calibration.marked_turns === 0) return <p className="text-sm text-gray-500">{t("empty")}</p>;
    return (
        <ul className="min-w-0 space-y-2">
            {calibration.levels.map((level) => (
                <li key={level.level} className="min-w-0 space-y-0.5 text-sm">
                    <p className="break-words text-gray-900">{levels(LEVEL_KEY[level.level])}</p>
                    {level.marked === 0 ? (
                        <p className="text-gray-500">{t("none")}</p>
                    ) : (
                        <p className="text-gray-700">
                            {t("line", { coincided: level.coincided, marked: level.marked })}
                            {level.partial > 0 && ` · ${t("partial", { count: level.partial })}`}
                            {!level.enough && ` · ${t("fewData")}`}
                        </p>
                    )}
                </li>
            ))}
        </ul>
    );
}

export function HintsLine({ requested, maxLevel, mentor }: { requested: number; maxLevel: number; mentor: boolean }) {
    const t = useTranslations("training.criterion.map.hints");
    const who = mentor ? "mentor" : "mine";
    return (
        <p className="text-sm text-gray-700">
            {requested === 0 ? t(`${who}.none`) : t(`${who}.some`, { count: requested, level: maxLevel })}
        </p>
    );
}

export function useVerdictLabel() {
    const t = useTranslations("training.criterion.turn.verdicts");
    return (verdict: TrainingVerdictValue) => t(verdict === "no_coincide" ? "noCoincide" : verdict);
}

/** One retake as it stands: its question, the answer and the AI's contrast. */
export function RetakeEntry({ retake, children }: { retake: TrainingRetake; children?: ReactNode }) {
    const t = useTranslations("training.criterion.map.retakes");
    const verdictLabel = useVerdictLabel();
    return (
        <li className="min-w-0 space-y-2 border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
            <div className="min-w-0 space-y-0.5">
                <p className="break-words text-sm font-medium text-gray-900">{retake.topic_label}</p>
                <p className="text-sm text-gray-500">
                    {t(retake.status === "failed" && retake.question ? "status.closed" : `status.${retake.status}`)} · {t("started", { date: new Date(retake.created_at) })}
                </p>
            </div>
            {retake.question && (
                <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-gray-500">{t("question")}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{retake.question}</p>
                </div>
            )}
            {retake.answer && (
                <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-gray-500">{t("answer")}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-gray-900">{retake.answer}</p>
                </div>
            )}
            {retake.contrast && (
                <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-gray-500">{t("contrast")}</p>
                    <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{retake.contrast}</p>
                </div>
            )}
            {retake.verdict && (
                <p className="text-sm text-gray-700">{t("verdict", { verdict: verdictLabel(retake.verdict) })}</p>
            )}
            {children}
        </li>
    );
}

/** The sentences for the codes the retake routes answer, for `notifyError`. */
export function useRetakeCodeMessages() {
    const t = useTranslations("training.criterion.map.codes");
    return {
        training_retake_not_due: t("notDue"),
        training_retake_in_progress: t("inProgress"),
        training_retake_not_open: t("notOpen"),
        training_review_key_required: t("keyRequired"),
        chat_route_credential_unavailable: t("credentialUnavailable"),
    };
}
