"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { getMyReadings, startReading, type TrainingReading } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { useReadingCodeMessages, useReadingStatusLabel } from "./readingShared";

// Ajustes → Formación → Mi formación: the notice of the periodic full reading
// for a junior (docs/training.md, layer 3). It offers one when it is due (30
// days after the last one was sent), shows the one in progress, and lists the
// person's readings. No reminders and nothing scheduled: it is here when
// they open Mi formación. The server decides who is eligible.

const readingHref = (readingId: string) => `/settings/training/reading/${encodeURIComponent(readingId)}`;

export function ReadingNotice({ orgId }: { orgId: string }) {
    const t = useTranslations("training.criterion.reading");
    const statusLabel = useReadingStatusLabel();
    const codeMessages = useReadingCodeMessages();
    const router = useRouter();
    const load = useCallback(() => getMyReadings(orgId), [orgId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.read",
    });
    const [busy, setBusy] = useState(false);

    const start = async () => {
        setBusy(true);
        try {
            const reading = await startReading(orgId);
            router.push(readingHref(reading.id));
        } catch (error) {
            notifyError(error, { action: t("actions.start"), operation: "training.read", codeMessages });
            setBusy(false);
            reload();
        }
    };

    if (failed && !data) return <LoadFailed onRetry={reload} />;
    if (!data)
        return (
            <div className="space-y-2" aria-busy="true">
                <SkeletonLine className="w-1/3" />
                <SkeletonLine className="w-2/3" />
            </div>
        );
    const { eligibility, readings } = data;
    if (!eligibility.is_junior && readings.length === 0) return null;
    const open = eligibility.open_reading_id;
    return (
        <section className="min-w-0 space-y-3" aria-labelledby={`reading-notice-${orgId}`}>
            <div className="space-y-0.5">
                <h3 id={`reading-notice-${orgId}`} className="text-sm font-medium text-gray-900">
                    {t("title")}
                </h3>
                <p className="text-sm text-gray-500">{t("intro")}</p>
            </div>
            {open ? (
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <p className="text-sm text-gray-700">{t("notice.open")}</p>
                    <PillButtonUI type="button" tone="black" size="sm" onClick={() => router.push(readingHref(open))}>
                        {t("notice.continue")}
                    </PillButtonUI>
                </div>
            ) : eligibility.due ? (
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <p className="text-sm text-gray-700">{t("notice.due")}</p>
                    <PillButtonUI type="button" tone="black" size="sm" loading={busy} onClick={() => void start()}>
                        {t("notice.start")}
                    </PillButtonUI>
                </div>
            ) : eligibility.next_due_at ? (
                <p className="text-sm text-gray-500">{t("notice.next", { date: new Date(eligibility.next_due_at) })}</p>
            ) : null}
            {readings.length > 0 && (
                <div className="min-w-0 space-y-1">
                    <h4 className="text-sm font-medium text-gray-700">{t("notice.history")}</h4>
                    <ul className="min-w-0 space-y-1">
                        {readings.map((reading) => (
                            <ReadingLine key={reading.id} reading={reading} label={statusLabel(reading.status)} />
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}

function ReadingLine({ reading, label }: { reading: TrainingReading; label: string }) {
    const t = useTranslations("training.criterion.reading.notice");
    const router = useRouter();
    const date = new Date(reading.submitted_at ?? reading.created_at);
    return (
        <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
            <span className="break-words">{t("item", { date, status: label })}</span>
            <TextButtonUI size="xs" aria-label={t("viewName", { date })} onClick={() => router.push(readingHref(reading.id))}>
                {t("view")}
            </TextButtonUI>
        </li>
    );
}
