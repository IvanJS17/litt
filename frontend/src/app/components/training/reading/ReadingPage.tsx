"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import {
    compareReading,
    getMyReading,
    getMyReadings,
    getReadingDocument,
    MikeApiError,
    submitReadingFindings,
    swapReading,
    type TrainingReadingDocument,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
    CredentialSelect,
    LoadFailed,
    useCredentialChoice,
    useSupervisionData,
} from "../supervision/supervisionShared";
import { ReadingResult, useReadingCodeMessages } from "./readingShared";

// Ajustes → Formación → Lectura completa (docs/training.md, layer 3). A page
// with the document's text and NO assistant: the person reads, writes what
// they found and sends it; only then can the machine's findings be compared.
// The server decides every step (the document, the one change, the written-
// once findings, the key); this page offers what it allows.

/** Polls a comparison that was started elsewhere (a reload in the middle of it). */
const COMPARING_POLL_MS = 5000;
const FINDINGS_MIN = 20;
const FINDINGS_MAX = 4000;
const DOCUMENT_UNAVAILABLE = "training_reading_document_unavailable";

type Loaded = {
    reading: Awaited<ReturnType<typeof getMyReading>>;
    document: TrainingReadingDocument | null;
    generation: Awaited<ReturnType<typeof getMyReadings>>["generation"];
};

export function ReadingPage({ readingId }: { readingId: string }) {
    const t = useTranslations("training.criterion.reading");
    const codeMessages = useReadingCodeMessages();
    const load = useCallback(async (): Promise<Loaded> => {
        const reading = await getMyReading(readingId);
        const [document, readings] = await Promise.all([
            getReadingDocument(readingId).catch((error: unknown) => {
                if (error instanceof MikeApiError && error.code === DOCUMENT_UNAVAILABLE) return null;
                throw error;
            }),
            getMyReadings(reading.org_id),
        ]);
        return { reading, document, generation: readings.generation };
    }, [readingId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.read",
    });
    const choice = useCredentialChoice(data?.generation);
    const [busy, setBusy] = useState(false);
    const [findings, setFindings] = useState("");
    const status = data?.reading.status;

    useEffect(() => {
        if (status !== "comparing") return;
        const timer = setTimeout(reload, COMPARING_POLL_MS);
        return () => clearTimeout(timer);
    }, [status, reload, data]);

    const run = async (action: string, change: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await change();
        } catch (error) {
            notifyError(error, { action, operation: "training.read", codeMessages });
        } finally {
            setBusy(false);
            reload();
        }
    };

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Link
                    href="/settings/training"
                    className="inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t("page.back")}
                </Link>
                <SettingsHeading id="lectura-completa">{t("page.title")}</SettingsHeading>
                <SettingsDescription>{t("page.noAssistant")}</SettingsDescription>
            </div>
            {failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <ReadingSkeleton />
            ) : (
                <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                    <DocumentPane document={data.document} />
                    <section className="min-w-0 space-y-4" aria-live="polite">
                        {data.reading.status === "assigned" ? (
                            <WriteFindings
                                swapped={data.reading.swapped}
                                busy={busy}
                                value={findings}
                                onChange={setFindings}
                                onSwap={() => void run(t("actions.swap"), () => swapReading(readingId))}
                                onSend={() =>
                                    void run(t("actions.send"), () => submitReadingFindings(readingId, findings))
                                }
                            />
                        ) : (
                            <AfterSending
                                reading={data.reading}
                                busy={busy}
                                choice={choice}
                                available={data.generation.available}
                                onCompare={() =>
                                    void run(t("actions.compare"), () => compareReading(readingId, choice.value))
                                }
                                onCheck={reload}
                            />
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}

function DocumentPane({ document }: { document: TrainingReadingDocument | null }) {
    const t = useTranslations("training.criterion.reading.page");
    return (
        <div className="min-w-0 space-y-2">
            <h3 id="reading-document" className="text-sm font-medium text-gray-900">
                {t("documentHeading")}
                {document?.filename ? <span className="break-words font-normal text-gray-500">: {document.filename}</span> : null}
            </h3>
            {document ? (
                <div
                    role="region"
                    aria-labelledby="reading-document"
                    tabIndex={0}
                    className="max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 text-sm leading-6 text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <p className="whitespace-pre-wrap break-words">{document.text}</p>
                </div>
            ) : (
                <p className="text-sm text-gray-500">{t("documentUnavailable")}</p>
            )}
        </div>
    );
}

function WriteFindings({
    swapped,
    busy,
    value,
    onChange,
    onSwap,
    onSend,
}: {
    swapped: boolean;
    busy: boolean;
    value: string;
    onChange: (value: string) => void;
    onSwap: () => void;
    onSend: () => void;
}) {
    const t = useTranslations("training.criterion.reading.page");
    const long = [...value.trim()].length >= FINDINGS_MIN;
    return (
        <div className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-1">
                <label htmlFor="reading-findings" className="text-sm font-medium text-gray-900">
                    {t("findingsLabel")}
                </label>
                <p id="reading-findings-help" className="text-sm text-gray-500">
                    {t("findingsHelp")}
                </p>
                <textarea
                    id="reading-findings"
                    aria-describedby="reading-findings-help reading-findings-count"
                    value={value}
                    maxLength={FINDINGS_MAX}
                    disabled={busy}
                    onChange={(event) => onChange(event.target.value)}
                    className="min-h-56 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
                />
                <p id="reading-findings-count" className="text-xs text-gray-500">
                    {long
                        ? t("findingsCount", { count: [...value].length, max: FINDINGS_MAX })
                        : t("findingsMin", { min: FINDINGS_MIN })}
                </p>
            </div>
            <p className="text-sm text-gray-500">{t("sendHint")}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
                <PillButtonUI type="button" tone="black" size="sm" disabled={busy || !long} loading={busy} onClick={onSend}>
                    {t("send")}
                </PillButtonUI>
                <PillButtonUI type="button" tone="white" size="sm" disabled={busy || swapped} onClick={onSwap}>
                    {t("changeDocument")}
                </PillButtonUI>
                <span className="text-sm text-gray-500">{swapped ? t("changeUsed") : t("changeHint")}</span>
            </div>
        </div>
    );
}

function AfterSending({
    reading,
    busy,
    choice,
    available,
    onCompare,
    onCheck,
}: {
    reading: Loaded["reading"];
    busy: boolean;
    choice: ReturnType<typeof useCredentialChoice>;
    available: boolean;
    onCompare: () => void;
    onCheck: () => void;
}) {
    const t = useTranslations("training.criterion.reading");
    const comparing = busy || reading.status === "comparing";
    return (
        <div className="min-w-0 space-y-4">
            <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-medium text-gray-900">{t("page.findingsLabel")}</h3>
                {reading.submitted_at && (
                    <p className="text-xs text-gray-500">{t("page.sentOn", { date: new Date(reading.submitted_at) })}</p>
                )}
                <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{reading.findings}</p>
            </div>
            {reading.status === "compared" ? (
                <ReadingResult reading={reading} />
            ) : (
                <div className="min-w-0 space-y-3">
                    {reading.status === "failed" && !busy && <p className="text-sm text-gray-700">{t("page.failed")}</p>}
                    {comparing && <p className="text-sm text-gray-700">{t("page.comparing")}</p>}
                    {!available && !comparing && <p className="text-sm text-gray-500">{t("page.noKey")}</p>}
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <CredentialSelect id="reading-key" choice={choice} disabled={comparing} />
                        {reading.status === "comparing" && !busy ? (
                            <PillButtonUI type="button" tone="white" size="sm" onClick={onCheck}>
                                {t("page.check")}
                            </PillButtonUI>
                        ) : (
                            <PillButtonUI
                                type="button"
                                tone="black"
                                size="sm"
                                disabled={comparing || !available || !choice.ready}
                                loading={busy}
                                onClick={onCompare}
                            >
                                {reading.status === "failed" ? t("page.retry") : t("page.compare")}
                            </PillButtonUI>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/** The loading state, in the layout of the page: the document and the form. */
function ReadingSkeleton() {
    const t = useTranslations("common");
    return (
        <div
            className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
            aria-busy="true"
            aria-label={t("loading")}
        >
            <div className="space-y-2">
                <SkeletonLine className="w-1/3" />
                <div className="space-y-2 rounded-xl border border-gray-100 p-4">
                    {Array.from({ length: 8 }, (_, index) => (
                        <SkeletonLine key={index} className={index % 3 === 2 ? "w-2/3" : "w-full"} />
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <SkeletonLine className="w-1/2" />
                <div className="h-56 animate-pulse rounded-xl bg-gray-100" />
                <SkeletonLine className="w-1/3" />
            </div>
        </div>
    );
}
