"use client";

import { useTranslations } from "next-intl";
import type { TrainingReading, TrainingReadingStatus } from "@/app/lib/mikeApi";

// Pieces shared by the reading page, «Mi formación» and the mentor's section
// (LiTT training layer 3, docs/training.md). The person's own words and the
// machine's findings are shown as the server sends them and never translated;
// only the labels around them are.

/** The label of a reading's state. */
export function useReadingStatusLabel() {
    const t = useTranslations("training.criterion.reading.status");
    return (status: TrainingReadingStatus) => t(status);
}

/** The sentences for the codes the server answers, for `notifyError`. */
export function useReadingCodeMessages() {
    const t = useTranslations("training.criterion.reading.codes");
    return {
        training_reading_not_due: t("notDue"),
        training_reading_no_document: t("noDocument"),
        training_reading_swap_used: t("swapUsed"),
        training_reading_findings_recorded: t("findingsRecorded"),
        training_reading_document_unavailable: t("documentUnavailable"),
    };
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
    return (
        <section className="min-w-0 space-y-2">
            <h4 className="text-sm font-medium text-gray-900">{title}</h4>
            {children.length === 0 ? (
                <p className="text-sm text-gray-500">{empty}</p>
            ) : (
                <ul className="min-w-0 space-y-3">{children}</ul>
            )}
        </section>
    );
}

function Passage({ excerpt }: { excerpt: string }) {
    const t = useTranslations("training.criterion.reading.result");
    return (
        <blockquote className="min-w-0 border-l-2 border-gray-200 pl-3 text-sm text-gray-500">
            <span className="block text-xs">{t("passage")}</span>
            <span className="block whitespace-pre-wrap break-words">{excerpt}</span>
        </blockquote>
    );
}

/**
 * «Coincidieron / Solo lo viste tú / Solo lo vio la máquina», as text under
 * headings (state is never carried by color). Only for a compared reading.
 */
export function ReadingResult({ reading }: { reading: TrainingReading }) {
    const t = useTranslations("training.criterion.reading.result");
    const { comparison, machine_findings: machine } = reading;
    if (!comparison || !machine) return null;
    const none = t("none");
    return (
        <div className="min-w-0 space-y-4">
            <p className="text-sm text-gray-500">{t("howItWorks")}</p>
            {machine.length === 0 && <p className="text-sm text-gray-700">{t("noMachine")}</p>}
            <Group title={t("both")} empty={none}>
                {comparison.both.map((pair) => (
                    <li key={`${pair.person}-${pair.machine}`} className="min-w-0 space-y-1">
                        <p className="break-words text-sm text-gray-900">
                            <span className="text-gray-500">{t("you")}: </span>
                            {comparison.person_items[pair.person]}
                        </p>
                        <p className="break-words text-sm text-gray-900">
                            <span className="text-gray-500">{t("machine")}: </span>
                            {machine[pair.machine]?.text} <span className="text-gray-500">({t("inferred")})</span>
                        </p>
                        {machine[pair.machine] && <Passage excerpt={machine[pair.machine].excerpt} />}
                    </li>
                ))}
            </Group>
            <Group title={t("onlyYou")} empty={none}>
                {comparison.only_person.map((index) => (
                    <li key={index} className="break-words text-sm text-gray-900">
                        {comparison.person_items[index]}
                    </li>
                ))}
            </Group>
            <Group title={t("onlyMachine")} empty={none}>
                {comparison.only_machine.map((index) => (
                    <li key={index} className="min-w-0 space-y-1">
                        <p className="break-words text-sm text-gray-900">{machine[index]?.text}</p>
                        {machine[index] && <Passage excerpt={machine[index].excerpt} />}
                    </li>
                ))}
            </Group>
            {comparison.discarded > 0 && (
                <p className="text-sm text-gray-500">{t("discarded", { count: comparison.discarded })}</p>
            )}
        </div>
    );
}
