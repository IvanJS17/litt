"use client";

import { useId } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { StorageUsage } from "@mike/contracts";
import { GlassCardUI, MeterUI, PillButtonUI } from "@mike/ui";
import { SettingsDescription, SettingsNotice } from "@/app/components/settings/SettingsText";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { useStorageUsage } from "@/app/hooks/useStorageUsage";
import { formatBytes } from "@/app/lib/formatBytes";
import { storageMeter } from "@/app/lib/storageUsage";

/**
 * How much of a storage space is in use: the person's own (no `orgId`) or a
 * firm's. A meter, «X de Y en uso», what counts, and from 80 % a notice that
 * the space is almost full; at the limit, that new files cannot be uploaded,
 * that everything stored stays available and how to free space. Nothing is
 * deleted at the limit.
 * Loading draws the same layout as a skeleton; a failed read says so, with a
 * retry only when trying again can help.
 */
export function StorageUsageCard({ orgId }: { orgId?: string }) {
    const t = useTranslations();
    const headingId = useId();
    const { state, retry } = useStorageUsage(orgId);
    const firm = orgId !== undefined;

    return (
        <section className="space-y-3" aria-labelledby={headingId}>
            <SettingsHeading id={headingId}>
                {t(firm ? "settings.storage.firmHeading" : "settings.storage.personalHeading")}
            </SettingsHeading>
            <GlassCardUI>
                {state.status === "loading" ? (
                    <div role="status" aria-busy="true">
                        <span className="sr-only">{t("common.loading")}</span>
                        {/* The loaded layout: the meter over its sentence, then the line on what counts. */}
                        <SettingsRow layout="stacked">
                            <div aria-hidden="true" className="space-y-2">
                                <div className="h-2 w-full animate-pulse rounded-full bg-gray-200" />
                                <div className="h-5 w-48 max-w-full animate-pulse rounded bg-gray-200" />
                            </div>
                        </SettingsRow>
                        <SettingsRow layout="stacked">
                            <div aria-hidden="true" className="h-5 w-72 max-w-full animate-pulse rounded bg-gray-200" />
                        </SettingsRow>
                    </div>
                ) : null}
                {state.status === "failed" ? (
                    <SettingsRow>
                        <div role="alert" className="min-w-0 space-y-0.5 text-sm text-red-700 [overflow-wrap:anywhere]">
                            <p className="font-medium">{state.error.title}</p>
                            <p>{state.error.message}</p>
                        </div>
                        {state.error.retryable ? (
                            <PillButtonUI tone="white" size="sm" type="button" className="shrink-0 self-start sm:self-center" onClick={retry}>
                                {t("common.retry")}
                            </PillButtonUI>
                        ) : null}
                    </SettingsRow>
                ) : null}
                {state.status === "loaded" ? (
                    <StorageUsageBody usage={state.usage} firm={firm} />
                ) : null}
            </GlassCardUI>
        </section>
    );
}

function StorageUsageBody({ usage, firm }: { usage: StorageUsage; firm: boolean }) {
    const t = useTranslations();
    const format = useFormatter();
    const { percent, level } = storageMeter(usage);
    const sentence = t("settings.storage.usage", {
        used: formatBytes(usage.usedBytes, format),
        limit: formatBytes(usage.limitBytes, format),
    });
    return (
        <>
            <SettingsRow layout="stacked">
                <div className="min-w-0 space-y-2">
                    <MeterUI
                        label={t("settings.storage.meterLabel")}
                        value={percent}
                        valueText={sentence}
                    />
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-gray-900">
                        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{sentence}</span>
                        <span className="text-gray-600">
                            {t("settings.storage.percent", {
                                percent: format.number(percent / 100, { style: "percent" }),
                            })}
                        </span>
                    </p>
                </div>
            </SettingsRow>
            {level === "ok" ? null : (
                <SettingsRow layout="stacked">
                    <SettingsNotice
                        entries={[
                            {
                                icon: "info",
                                label: t(
                                    level === "full"
                                        ? "settings.storage.fullLabel"
                                        : "settings.storage.almostFullLabel",
                                ),
                            },
                        ]}
                    >
                        {level === "full"
                            ? t(firm ? "settings.storage.fullBodyFirm" : "settings.storage.fullBodyPersonal")
                            : t("settings.storage.almostFullBody")}
                    </SettingsNotice>
                </SettingsRow>
            )}
            <SettingsRow layout="stacked">
                <div className="min-w-0 space-y-1">
                    {firm ? <SettingsDescription>{t("settings.storage.sharedFirm")}</SettingsDescription> : null}
                    <SettingsDescription>
                        {t(firm ? "settings.storage.countsFirm" : "settings.storage.countsPersonal")}
                    </SettingsDescription>
                </div>
            </SettingsRow>
        </>
    );
}
