"use client";

import { useTranslations } from "next-intl";
import type { TrainingGymAttempt, TrainingGymErrorKind } from "@/app/lib/mikeApi";

// Layer 4 «Gimnasio» (docs/training.md): pieces shared by the pupil's and the
// mentor's screens. Every case is fictitious and says so on every screen.

export const GYM_KINDS: TrainingGymErrorKind[] = [
    "superseded_thesis",
    "repealed_article",
    "wrong_jurisdiction",
    "invented_citation",
    "other",
];

export function useGymKindOptions() {
    const t = useTranslations("training.gym.kinds");
    return GYM_KINDS.map((kind) => ({ value: kind, label: t(kind) }));
}

export function GymNotice() {
    const t = useTranslations("training.gym");
    return <p className="text-sm font-medium text-gray-900">{t("notice")}</p>;
}

/** The attempt's result: found, missed with the why, findings with no error, hints. */
export function GymResult({ attempt }: { attempt: TrainingGymAttempt }) {
    const t = useTranslations("training.gym");
    const { result, errors } = attempt;
    if (!result || !errors) return null;
    const notes = new Map(attempt.findings.map((finding) => [finding.paragraph, finding.note]));
    return (
        <div className="min-w-0 space-y-3">
            <h4 className="text-sm font-medium text-gray-900">{t("result.title")}</h4>
            <p className="text-sm text-gray-700">
                {t("result.summary", { found: result.found.length, total: errors.length })}
            </p>
            <GymList title={t("result.found")} empty={result.found.length === 0}>
                {result.found.map((item) => (
                    <li key={item.error_index} className="break-words">
                        {t("paragraph", { number: item.paragraph })}:{" "}
                        {t(`kinds.${errors[item.error_index].kind}`)} (
                        {item.kind_matches ? t("result.kindOk") : t("result.kindDiff")})
                        {notes.get(item.paragraph) ? ` · ${t("result.note", { note: notes.get(item.paragraph)! })}` : ""}
                    </li>
                ))}
            </GymList>
            <GymList title={t("result.missed")} empty={result.missed.length === 0}>
                {result.missed.map((item) => (
                    <li key={item.error_index} className="break-words">
                        {t("paragraph", { number: item.paragraph })}: {t(`kinds.${errors[item.error_index].kind}`)}.{" "}
                        {errors[item.error_index].explanation}
                    </li>
                ))}
            </GymList>
            <GymList title={t("result.extra")} empty={result.extra.length === 0}>
                {result.extra.map((item) => (
                    <li key={item.paragraph} className="break-words">
                        {t("paragraph", { number: item.paragraph })}: {t("result.extraNote")}
                    </li>
                ))}
            </GymList>
            <p className="text-sm text-gray-700">{t("result.hints", { count: attempt.hints_used })}</p>
        </div>
    );
}

function GymList({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
    const t = useTranslations("training.gym");
    return (
        <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-gray-900">{title}</p>
            {empty ? (
                <p className="text-sm text-gray-500">{t("result.none")}</p>
            ) : (
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700">{children}</ul>
            )}
        </div>
    );
}
