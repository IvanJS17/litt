"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import {
    completeReviewAudit,
    getReviewAudit,
    markReviewAuditCell,
    startReviewAudit,
    type TrainingAuditCell,
    type TrainingAuditMark,
    type TrainingReviewAudit,
    type TrainingReviewAuditState,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
    AUDIT_MARKS,
    AUDIT_NOTE_MAX_CHARS,
    AuditCellBody,
    ColumnList,
    LintNotes,
    useColumnLabel,
} from "./reviewAuditShared";

// LiTT training layer 3, bulk review designer (docs/training.md): the
// junior's page on a tabular review. They see what code says about their
// questions, then mark by hand the sample the server drew. The marks, not the
// answers, are saved; nothing here is a grade and nothing is blocked.

const cellKey = (cell: { row_id: string; column_index: number }) => `${cell.row_id}:${cell.column_index}`;

export function ReviewAuditPage({ reviewId }: { reviewId: string }) {
    const t = useTranslations("training.criterion.audit");
    const tc = useTranslations();
    const [state, setState] = useState<TrainingReviewAuditState | null>(null);
    const [failed, setFailed] = useState(false);
    const [generation, setGeneration] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const reload = useCallback(() => setGeneration((value) => value + 1), []);

    useEffect(() => {
        let cancelled = false;
        getReviewAudit(reviewId).then(
            (next) => {
                if (cancelled) return;
                setState(next);
                setFailed(false);
            },
            (error: unknown) => {
                if (cancelled) return;
                setFailed(true);
                notifyError(error, { action: t("actions.load"), operation: "training.read" });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [reviewId, generation, t]);

    const codeMessages = { training_review_audit_stale: t("codes.stale") };
    const run = async (name: string, action: string, change: () => Promise<TrainingReviewAudit>) => {
        setBusy(name);
        try {
            const audit = await change();
            setState((current) => (current ? { ...current, audit } : current));
        } catch (error) {
            notifyError(error, { action, operation: "training.manage", codeMessages });
            reload();
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="mx-auto w-full max-w-3xl min-w-0 space-y-6 px-3 py-6 md:px-6.5">
            <div className="space-y-2">
                <Link
                    href={`/tabular-reviews/${encodeURIComponent(reviewId)}`}
                    className="inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t("backToReview")}
                </Link>
                <h1 className="font-serif text-2xl text-gray-900">{t("pageTitle")}</h1>
                <p className="text-sm text-gray-500">{t("intro")}</p>
            </div>
            {failed && !state ? (
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <p className="text-sm text-gray-500">{tc("training.loadFailed")}</p>
                    <PillButtonUI type="button" tone="white" size="sm" onClick={reload}>
                        {tc("common.retry")}
                    </PillButtonUI>
                </div>
            ) : !state ? (
                <AuditSkeleton />
            ) : !state.applies ? (
                <p className="text-sm text-gray-700">{t("notApplies")}</p>
            ) : (
                <>
                    <DesignSection state={state} />
                    <section aria-labelledby="audit-sample-title" className="space-y-3">
                        <h2 id="audit-sample-title" className="text-base font-medium text-gray-900">
                            {t("sample.title")}
                        </h2>
                        <SampleSection
                            state={state}
                            busy={busy}
                            onStart={() => void run("start", t("actions.start"), () => startReviewAudit(reviewId))}
                            onMark={(cell, mark, note) =>
                                void run(cellKey(cell), t("actions.mark"), () =>
                                    markReviewAuditCell(reviewId, cell, { mark, note: note.trim() || null }),
                                )
                            }
                            onFinish={() => void run("finish", t("actions.finish"), () => completeReviewAudit(reviewId))}
                        />
                    </section>
                </>
            )}
        </div>
    );
}

function AuditSkeleton() {
    const t = useTranslations("common");
    return (
        <div className="space-y-3" aria-busy="true" aria-label={t("loading")}>
            {[0, 1].map((index) => (
                <div key={index} className="space-y-2 rounded-xl border border-gray-100 p-4">
                    <SkeletonLine className="w-2/3" />
                    <SkeletonLine className="w-1/2" />
                    <SkeletonLine className="w-5/6" />
                </div>
            ))}
        </div>
    );
}

function DesignSection({ state }: { state: TrainingReviewAuditState }) {
    const t = useTranslations("training.criterion.audit");
    // The questions as they were when the audit began; with none (or an expired
    // one), the questions now.
    const live = state.audit && state.audit.status !== "stale" ? state.audit : null;
    const columns = live?.columns ?? state.columns;
    return (
        <section aria-labelledby="audit-design-title" className="space-y-3">
            <h2 id="audit-design-title" className="text-base font-medium text-gray-900">
                {t("design.title")}
            </h2>
            <p className="text-sm text-gray-500">{t("design.intro")}</p>
            <GlassCardUI>
                <div className="min-w-0 space-y-3 p-4">
                    <LintNotes columns={columns} lint={live?.lint ?? state.lint} />
                    {columns.length > 0 && <ColumnList columns={columns} />}
                </div>
            </GlassCardUI>
        </section>
    );
}

function SampleSection({
    state,
    busy,
    onStart,
    onMark,
    onFinish,
}: {
    state: TrainingReviewAuditState;
    busy: string | null;
    onStart: () => void;
    onMark: (cell: TrainingAuditCell, mark: TrainingAuditMark, note: string) => void;
    onFinish: () => void;
}) {
    const t = useTranslations("training.criterion.audit");
    const audit = state.audit;
    if (!audit || audit.status === "stale") {
        if (!state.ready) return <p className="text-sm text-gray-700">{t("sample.notReady")}</p>;
        return (
            <div className="space-y-3">
                {audit?.status === "stale" && <p className="text-sm text-gray-700">{t("sample.stale")}</p>}
                <PillButtonUI type="button" tone="black" size="sm" loading={busy === "start"} disabled={busy !== null} onClick={onStart}>
                    {audit ? t("sample.startAnother") : t("sample.start")}
                </PillButtonUI>
            </div>
        );
    }
    const marked = audit.cells.filter((cell) => cell.mark !== null).length;
    const open = audit.status === "open";
    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("sample.intro", { count: audit.cells.length })}</p>
            {audit.cells.map((cell) => (
                <CellCard key={cellKey(cell)} audit={audit} cell={cell} disabled={!open || busy !== null} onMark={onMark} />
            ))}
            {open ? (
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <p role="status" className="text-sm text-gray-700">
                        {t("sample.progress", { done: marked, total: audit.cells.length })}
                    </p>
                    <PillButtonUI
                        type="button"
                        tone="black"
                        size="sm"
                        loading={busy === "finish"}
                        disabled={busy !== null || marked < audit.cells.length}
                        onClick={onFinish}
                    >
                        {t("sample.finish")}
                    </PillButtonUI>
                </div>
            ) : (
                <ResultSection audit={audit} />
            )}
        </div>
    );
}

function CellCard({
    audit,
    cell,
    disabled,
    onMark,
}: {
    audit: TrainingReviewAudit;
    cell: TrainingAuditCell;
    disabled: boolean;
    onMark: (cell: TrainingAuditCell, mark: TrainingAuditMark, note: string) => void;
}) {
    const t = useTranslations("training.criterion.audit");
    const label = useColumnLabel(audit.columns);
    const [note, setNote] = useState(cell.note ?? "");
    const name = `mark-${cellKey(cell)}`;
    return (
        <GlassCardUI>
            <article className="min-w-0 space-y-3 p-4" aria-label={t("cell.title", { row: cell.row_label ?? "", column: label(cell.column_index) })}>
                <h3 className="break-words text-sm font-medium text-gray-900">
                    {t("cell.title", { row: cell.row_label ?? "", column: label(cell.column_index) })}
                </h3>
                <AuditCellBody cell={cell} />
                {!cell.withheld && (
                    <fieldset className="min-w-0 space-y-2 border-t border-gray-100 pt-3" disabled={disabled}>
                        <legend className="text-xs font-medium text-gray-500">{t("cell.markLegend")}</legend>
                        <div role="radiogroup" aria-label={t("cell.markLegend")} className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
                            {AUDIT_MARKS.map((mark) => (
                                <label key={mark} className="inline-flex items-center gap-2 text-sm text-gray-900">
                                    <input
                                        type="radio"
                                        name={name}
                                        value={mark}
                                        checked={cell.mark === mark}
                                        onChange={() => onMark(cell, mark, note)}
                                        className="h-4 w-4 accent-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                    />
                                    {t(`marks.${mark}`)}
                                </label>
                            ))}
                        </div>
                        <textarea
                            aria-label={t("cell.note")}
                            placeholder={t("cell.note")}
                            value={note}
                            maxLength={AUDIT_NOTE_MAX_CHARS}
                            onChange={(event) => setNote(event.target.value)}
                            onBlur={() => {
                                // A note is saved with the mark it belongs to.
                                if (cell.mark && note.trim() !== (cell.note ?? "")) onMark(cell, cell.mark, note);
                            }}
                            className="min-h-16 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
                        />
                    </fieldset>
                )}
                {cell.mentor_mark && (
                    <p className="text-sm text-gray-700">{t("cell.mentorMark", { mark: t(`markWord.${cell.mentor_mark}`) })}</p>
                )}
            </article>
        </GlassCardUI>
    );
}

function ResultSection({ audit }: { audit: TrainingReviewAudit }) {
    const t = useTranslations("training.criterion.audit");
    return (
        <section aria-labelledby="audit-result-title" className="space-y-2">
            <h3 id="audit-result-title" className="text-base font-medium text-gray-900">
                {t("result.title")}
            </h3>
            {audit.completed_at && <p className="text-sm text-gray-500">{t("result.done", { date: new Date(audit.completed_at) })}</p>}
            <ul className="min-w-0 space-y-1 text-sm text-gray-700">
                {(audit.tally ?? []).map((column) => (
                    <li key={column.column_index} className="break-words">
                        {t("result.column", {
                            column: column.column_name.trim() ? `“${column.column_name.trim()}”` : t("design.column", { number: column.column_index + 1 }),
                            marked: column.marked,
                            incorrect: column.incorrect,
                            incomplete: column.incomplete,
                        })}
                    </li>
                ))}
            </ul>
            {audit.evaluation && (
                <div className="min-w-0 space-y-1 border-t border-gray-100 pt-3">
                    <p className="text-sm font-medium text-gray-900">
                        {t("evaluation.title")}: {t(`evaluation.${audit.evaluation.outcome}`)}
                    </p>
                    {audit.evaluation.note && <p className="whitespace-pre-wrap break-words text-sm text-gray-700">{audit.evaluation.note}</p>}
                </div>
            )}
        </section>
    );
}
