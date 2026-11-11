"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import type { VersionCompare, VersionCompareSide } from "@mike/contracts";
import { ModalUI, PillButtonUI, TextButtonUI } from "@mike/ui";
import { ModalSegmentedToggle } from "@/app/components/modals/ModalSegmentedToggle";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { compareDocumentVersions, type DocumentVersion } from "@/app/lib/mikeApi";
import { downloadDocumentFile } from "@/app/lib/downloadDocument";
import { describeError, notifyError } from "@/app/lib/userFacingError";
import { compareTexts, type CompareOutcome, type TextChange } from "@/app/lib/textDiff";
import {
    compareBlocks,
    compareReadiness,
    groupChanges,
    isMarkdownName,
    versionAuthor,
} from "@/app/lib/versionCompare";
import { cn } from "@/app/lib/utils";
import { ChangeList } from "./ChangeList";
import { VersionDiff, type DiffViewMode } from "./VersionDiff";

/** Newest first, the order the versions panel lists them in. */
function newestFirst(versions: DocumentVersion[]) {
    return versions
        .filter((version) => version.deleted_at == null)
        .sort(
            (a, b) =>
                (b.version_number ?? -Infinity) - (a.version_number ?? -Infinity) ||
                b.created_at.localeCompare(a.created_at),
        );
}

/** The comparison skeleton: the toolbar, the diff rows and the list of changes. */
export function VersionCompareSkeleton({ label }: { label: string }) {
    return (
        <div
            role="status"
            aria-label={label}
            className="grid min-h-0 flex-1 gap-4 py-2 lg:grid-cols-[minmax(0,1fr)_16rem]"
        >
            <div className="space-y-2">
                {[96, 80, 100, 72, 90, 64, 98, 84].map((width, index) => (
                    <div
                        key={index}
                        className="h-4 animate-pulse rounded bg-gray-100"
                        style={{ width: `${width}%` }}
                    />
                ))}
            </div>
            <div className="hidden space-y-2 lg:block">
                {[100, 70, 85, 60].map((width, index) => (
                    <div
                        key={index}
                        className="h-8 animate-pulse rounded bg-gray-100"
                        style={{ width: `${width}%` }}
                    />
                ))}
            </div>
        </div>
    );
}

function Message({ children, role }: { children: React.ReactNode; role?: "alert" | "status" }) {
    return (
        <div
            role={role}
            className="rounded-md bg-gray-50 px-3 py-3 text-sm text-gray-700"
        >
            {children}
        </div>
    );
}

function CompareBody({
    documentId,
    versions,
    currentVersionId,
}: {
    documentId: string;
    versions: DocumentVersion[];
    currentVersionId: string | null;
}) {
    const t = useTranslations("versionCompare");
    const ordered = useMemo(() => newestFirst([...versions]), [versions]);
    const initialHead =
        ordered.find((version) => version.id === currentVersionId) ?? ordered[0];
    const initialBase = ordered[ordered.indexOf(initialHead) + 1] ?? ordered[1];
    const [baseId, setBaseId] = useState(initialBase?.id ?? "");
    const [headId, setHeadId] = useState(initialHead?.id ?? "");
    const [mode, setMode] = useState<DiffViewMode>("side-by-side");
    const [numbersOnly, setNumbersOnly] = useState(false);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [attempt, setAttempt] = useState(0);

    // --- The two texts ------------------------------------------------------
    const requestKey = `${documentId}:${baseId}:${headId}:${attempt}`;
    const [fetched, setFetched] = useState<{
        key: string;
        data?: VersionCompare;
        error?: unknown;
    } | null>(null);
    const samePick = !baseId || !headId || baseId === headId;
    useEffect(() => {
        if (samePick) return;
        let cancelled = false;
        compareDocumentVersions(documentId, baseId, headId)
            .then((data) => !cancelled && setFetched({ key: requestKey, data }))
            .catch((error: unknown) => !cancelled && setFetched({ key: requestKey, error }));
        return () => {
            cancelled = true;
        };
    }, [documentId, baseId, headId, samePick, requestKey]);
    const response = !samePick && fetched?.key === requestKey ? fetched : null;
    const data = response?.data ?? null;

    const readiness = data ? compareReadiness(data.base, data.head) : null;

    // --- The diff, off the click that asked for it --------------------------
    const [computed, setComputed] = useState<{
        data: VersionCompare;
        outcome: CompareOutcome;
    } | null>(null);
    useEffect(() => {
        if (!data || readiness?.kind !== "ready") return;
        const timer = setTimeout(
            () =>
                setComputed({
                    data,
                    outcome: compareTexts(data.base.text ?? "", data.head.text ?? ""),
                }),
            0,
        );
        return () => clearTimeout(timer);
    }, [data, readiness?.kind]);
    const outcome = computed?.data === data ? computed.outcome : null;
    const comparison = outcome?.status === "ok" ? outcome.comparison : null;

    // --- Navigation ---------------------------------------------------------
    const visible = useMemo(
        () =>
            (comparison?.changes ?? []).filter(
                (change) => !numbersOnly || change.numeric,
            ),
        [comparison, numbersOnly],
    );
    const active =
        visible.find((change) => change.index === activeId) ?? visible[0] ?? null;
    const position = active ? visible.indexOf(active) : -1;
    const positions = useMemo(
        () =>
            new Map(
                visible.map((change, at) => [
                    change.index,
                    { position: at + 1, total: visible.length },
                ]),
            ),
        [visible],
    );
    const blocks = useMemo(
        () =>
            comparison
                ? compareBlocks(comparison, (change) => !numbersOnly || change.numeric)
                : [],
        [comparison, numbersOnly],
    );
    const elements = useRef(new Map<number, HTMLElement>());
    const registerChange = useCallback((index: number, element: HTMLElement | null) => {
        if (element) elements.current.set(index, element);
        else elements.current.delete(index);
    }, []);
    const [scrollTo, setScrollTo] = useState<{ index: number; n: number } | null>(null);
    useEffect(() => {
        if (scrollTo)
            elements.current.get(scrollTo.index)?.scrollIntoView?.({ block: "center" });
    }, [scrollTo]);
    const goTo = (change: TextChange) => {
        setActiveId(change.index);
        setScrollTo((last) => ({ index: change.index, n: (last?.n ?? 0) + 1 }));
    };

    // --- Labels -------------------------------------------------------------
    const authorLabel = (source: string | null | undefined) =>
        versionAuthor(source) === "ai" ? t("authorAi") : t("authorPerson");
    const options = ordered.map((version) => ({
        value: version.id,
        label:
            version.version_number != null
                ? t("versionOption", {
                      number: version.version_number,
                      author: authorLabel(version.source),
                      name: version.filename ?? "",
                  })
                : t("versionOptionNoNumber", {
                      author: authorLabel(version.source),
                      name: version.filename ?? "",
                  }),
    }));
    const sideSource = (side: "base" | "head") => {
        const fromData: VersionCompareSide | undefined = data?.[side];
        if (fromData) return fromData.source;
        return ordered.find((v) => v.id === (side === "base" ? baseId : headId))?.source;
    };
    const headName =
        data?.head.filename ??
        ordered.find((version) => version.id === headId)?.filename ??
        "";
    const byHeading = isMarkdownName(headName);

    const [downloading, setDownloading] = useState<string | null>(null);
    const downloadVersion = async (id: string) => {
        setDownloading(id);
        try {
            const version = ordered.find((v) => v.id === id);
            await downloadDocumentFile(documentId, id, version?.filename ?? "document");
        } catch (error) {
            notifyError(error, {
                action: "download this version",
                operation: "documents.download",
            });
        } finally {
            setDownloading(null);
        }
    };

    const textless = Math.max(
        data?.base.textless_page_count ?? 0,
        data?.head.textless_page_count ?? 0,
    );
    const tooLarge = readiness?.kind === "too_large" || outcome?.status === "too_large";

    let content: React.ReactNode;
    if (samePick) {
        content = <Message role="status">{t("sameVersion")}</Message>;
    } else if (response?.error) {
        content = (
            <Message role="alert">
                <p>{describeError(response.error, { action: "load the comparison" }).message}</p>
                <TextButtonUI
                    size="sm"
                    className="mt-2"
                    onClick={() => setAttempt((count) => count + 1)}
                >
                    {t("retry")}
                </TextButtonUI>
            </Message>
        );
    } else if (!data || (readiness?.kind === "ready" && !outcome)) {
        content = <VersionCompareSkeleton label={t("loadingLabel")} />;
    } else if (readiness?.kind === "no_text") {
        content = <Message role="status">{t("noText")}</Message>;
    } else if (tooLarge) {
        content = (
            <Message role="status">
                <p className="font-medium">{t("tooLarge")}</p>
                <p className="mt-1 text-gray-600">{t("tooLargeHint")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {([baseId, headId] as const).map((id, at) => (
                        <PillButtonUI
                            key={at}
                            tone="white"
                            size="sm"
                            loading={downloading === id}
                            onClick={() => void downloadVersion(id)}
                        >
                            <Download aria-hidden="true" className="h-3.5 w-3.5" />
                            {at === 0 ? t("downloadBase") : t("downloadHead")}
                        </PillButtonUI>
                    ))}
                </div>
            </Message>
        );
    } else if (comparison && comparison.changes.length === 0) {
        content = <Message role="status">{t("identical")}</Message>;
    } else if (comparison && visible.length === 0) {
        content = <Message role="status">{t("noNumberChanges")}</Message>;
    } else {
        content = (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,3fr)_minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:grid-rows-[minmax(0,1fr)]">
                {/* On a phone the diff takes the modal's height and the list scrolls beneath it. */}
                <div className="min-h-0 overflow-auto rounded-lg bg-app-surface py-1">
                    <VersionDiff
                        blocks={blocks}
                        mode={mode}
                        positions={positions}
                        activeIndex={active?.index ?? null}
                        registerChange={registerChange}
                    />
                </div>
                <div className="min-h-0 overflow-y-auto">
                    <ChangeList
                        groups={groupChanges(visible, byHeading)}
                        byHeading={byHeading}
                        activeIndex={active?.index ?? null}
                        positions={positions}
                        onSelect={goTo}
                    />
                </div>
            </div>
        );
    }

    const showTools = !!comparison && visible.length > 0 && !tooLarge;
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4">
            <p className="text-xs text-gray-500">{t("textNotFormat")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
                {(["base", "head"] as const).map((side) => (
                    <div key={side} className="min-w-0 space-y-1">
                        <label
                            htmlFor={`compare-${side}`}
                            className="text-xs font-medium text-gray-900"
                        >
                            {side === "base" ? t("base") : t("head")}
                        </label>
                        <ModalSelect
                            id={`compare-${side}`}
                            value={side === "base" ? baseId : headId}
                            options={options}
                            onChange={side === "base" ? setBaseId : setHeadId}
                            className="h-9"
                            wrapLabels
                        />
                        <p className="text-xs text-gray-500">
                            {t("authorOf", { author: authorLabel(sideSource(side)) })}
                        </p>
                    </div>
                ))}
            </div>
            {textless > 0 && (
                <p
                    role="status"
                    className="rounded-md bg-warning-surface px-2 py-1.5 text-xs text-warning"
                >
                    {t("textlessPages", { count: textless })}
                </p>
            )}
            {showTools && (
                <div className="flex flex-wrap items-center gap-3">
                    <div role="group" aria-label={t("viewMode")}>
                        <ModalSegmentedToggle<DiffViewMode>
                            size="sm"
                            value={mode}
                            onChange={setMode}
                            options={[
                                { value: "side-by-side", label: t("sideBySide") },
                                { value: "unified", label: t("unified") },
                            ]}
                        />
                    </div>
                    <label
                        className="flex cursor-pointer items-center text-xs text-gray-700"
                        title={t("numbersOnlyHint")}
                    >
                        <input
                            type="checkbox"
                            className={cn(TABLE_CHECKBOX_CLASS, "mr-2")}
                            checked={numbersOnly}
                            onChange={(event) => setNumbersOnly(event.target.checked)}
                        />
                        {t("numbersOnly")}
                    </label>
                    <div className="ml-auto flex items-center gap-1">
                        <TextButtonUI
                            size="icon-xs"
                            aria-label={t("previous")}
                            title={t("previous")}
                            disabled={position <= 0}
                            onClick={() => goTo(visible[position - 1])}
                        >
                            <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
                        </TextButtonUI>
                        <span role="status" className="px-1 text-xs text-gray-700">
                            {t("changeOf", {
                                current: position + 1,
                                total: visible.length,
                            })}
                        </span>
                        <TextButtonUI
                            size="icon-xs"
                            aria-label={t("next")}
                            title={t("next")}
                            disabled={position >= visible.length - 1}
                            onClick={() => goTo(visible[position + 1])}
                        >
                            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                        </TextButtonUI>
                    </div>
                </div>
            )}
            {content}
        </div>
    );
}

/** Compare two versions of one document, text against text. */
export function VersionCompareModal({
    open,
    onClose,
    documentId,
    versions,
    currentVersionId,
}: {
    open: boolean;
    onClose: () => void;
    documentId: string;
    versions: DocumentVersion[];
    currentVersionId: string | null;
}) {
    const t = useTranslations("versionCompare");
    return (
        <ModalUI
            open={open}
            onClose={onClose}
            size="xl"
            className="h-[calc(100dvh-2rem)] max-w-6xl!"
            breadcrumbs={[t("title")]}
            ariaLabel={t("title")}
        >
            <CompareBody
                documentId={documentId}
                versions={versions}
                currentVersionId={currentVersionId}
            />
        </ModalUI>
    );
}
