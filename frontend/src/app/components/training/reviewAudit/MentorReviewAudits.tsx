"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import {
    evaluateReviewAudit,
    getPupilReviewAudits,
    type TrainingAuditMark,
    type TrainingAuditOutcome,
    type TrainingPupilReviewAudits,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
    CardsSkeleton,
    LoadFailed,
    useSupervisionData,
} from "../supervision/supervisionShared";
import {
    AUDIT_MARKS,
    AUDIT_NOTE_MAX_CHARS,
    AuditCellBody,
    ColumnList,
    LintNotes,
    useColumnLabel,
} from "./reviewAuditShared";

// LiTT training layer 3, bulk review designer (docs/training.md): the
// mentor's section. They read the questions a pupil designed and the sample
// the pupil marked by hand, may correct a mark (kept apart as theirs) and
// record «adequate» or «to improve» with a note. It is evidence: nothing is
// blocked. Mounted by the mentor panel's «Criterio» tab.

type Audit = TrainingPupilReviewAudits["audits"][number];

export function MentorReviewAudits({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.criterion.audit.mentor");
    const load = useCallback(() => getPupilReviewAudits(orgId, pupilId), [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });
    if (failed && !data) return <LoadFailed onRetry={reload} />;
    if (!data) return <CardsSkeleton />;
    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("intro")}</p>
            {data.without_access > 0 && <p className="text-sm text-gray-700">{t("withoutAccess", { count: data.without_access })}</p>}
            {data.audits.length === 0 && data.without_access === 0 && <p className="text-sm text-gray-500">{t("empty")}</p>}
            {data.audits.map((audit) => (
                <AuditCard key={audit.id} orgId={orgId} pupilId={pupilId} audit={audit} onSaved={reload} />
            ))}
        </div>
    );
}

function AuditCard({
    orgId,
    pupilId,
    audit,
    onSaved,
}: {
    orgId: string;
    pupilId: string;
    audit: Audit;
    onSaved: () => void;
}) {
    const t = useTranslations("training.criterion.audit");
    const label = useColumnLabel(audit.columns);
    const [outcome, setOutcome] = useState<TrainingAuditOutcome | null>(audit.evaluation?.outcome ?? null);
    const [note, setNote] = useState(audit.evaluation?.note ?? "");
    const [corrections, setCorrections] = useState<Record<string, TrainingAuditMark>>({});
    const [busy, setBusy] = useState(false);
    const complete = audit.status === "complete";

    const save = async () => {
        if (!outcome) return;
        setBusy(true);
        try {
            await evaluateReviewAudit(orgId, pupilId, audit.id, {
                outcome,
                note: note.trim() || null,
                corrections: Object.entries(corrections).map(([key, mark]) => {
                    const [row_id, column] = key.split(":");
                    return { row_id, column_index: Number(column), mark };
                }),
            });
            onSaved();
        } catch (error) {
            notifyError(error, {
                action: t("mentor.actions.evaluate"),
                operation: "training.manage",
                codeMessages: { training_review_audit_stale: t("mentor.codes.stale") },
            });
            onSaved();
        } finally {
            setBusy(false);
        }
    };

    return (
        <GlassCardUI>
            <article className="min-w-0 space-y-4 p-4">
                <header className="min-w-0 space-y-0.5">
                    <h3 className="break-words text-sm font-medium text-gray-900">{audit.review_title?.trim() || t("mentor.untitled")}</h3>
                    <p className="text-sm text-gray-500">
                        {t(`mentor.status.${audit.status}`)} · {t("mentor.started", { date: new Date(audit.created_at) })}
                    </p>
                </header>
                <LintNotes columns={audit.columns} lint={audit.lint} />
                <ColumnList columns={audit.columns} />
                {audit.cells.map((cell) => {
                    const key = `${cell.row_id}:${cell.column_index}`;
                    const chosen = corrections[key] ?? cell.mentor_mark ?? "";
                    return (
                        <div key={key} className="min-w-0 space-y-2 border-t border-gray-100 pt-3">
                            <p className="break-words text-sm font-medium text-gray-900">
                                {t("cell.title", { row: cell.row_label ?? "", column: label(cell.column_index) })}
                            </p>
                            <AuditCellBody cell={cell} />
                            <p className="text-sm text-gray-700">
                                {cell.mark ? t("mentor.personMark", { mark: t(`markWord.${cell.mark}`) }) : t("mentor.unmarked")}
                            </p>
                            {cell.note && <p className="whitespace-pre-wrap break-words text-sm text-gray-500">{cell.note}</p>}
                            {complete && !cell.withheld && (
                                <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-gray-900">
                                    {t("mentor.yourMark")}
                                    <select
                                        value={chosen}
                                        disabled={busy}
                                        onChange={(event) => {
                                            const mark = event.target.value as TrainingAuditMark | "";
                                            setCorrections((current) => {
                                                const next = { ...current };
                                                if (mark) next[key] = mark;
                                                else delete next[key];
                                                return next;
                                            });
                                        }}
                                        className="rounded-xl border border-gray-200 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                    >
                                        <option value="">{t("mentor.keepMark")}</option>
                                        {AUDIT_MARKS.map((mark) => (
                                            <option key={mark} value={mark}>
                                                {t(`marks.${mark}`)}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            )}
                        </div>
                    );
                })}
                {audit.withheld > 0 && <p className="text-sm text-gray-500">{t("mentor.withheld")}</p>}
                {complete ? (
                    <fieldset className="min-w-0 space-y-3 border-t border-gray-100 pt-3" disabled={busy}>
                        <legend className="text-sm font-medium text-gray-900">{t("mentor.evaluate")}</legend>
                        <div role="radiogroup" aria-label={t("mentor.evaluate")} className="flex min-w-0 flex-wrap gap-x-4 gap-y-2">
                            {(["adequate", "needs_work"] as const).map((value) => (
                                <label key={value} className="inline-flex items-center gap-2 text-sm text-gray-900">
                                    <input
                                        type="radio"
                                        name={`outcome-${audit.id}`}
                                        value={value}
                                        checked={outcome === value}
                                        onChange={() => setOutcome(value)}
                                        className="h-4 w-4 accent-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                    />
                                    {t(`evaluation.${value}`)}
                                </label>
                            ))}
                        </div>
                        <textarea
                            aria-label={t("mentor.noteLabel")}
                            placeholder={t("mentor.noteLabel")}
                            value={note}
                            maxLength={AUDIT_NOTE_MAX_CHARS}
                            onChange={(event) => setNote(event.target.value)}
                            className="min-h-20 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
                        />
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <PillButtonUI type="button" tone="black" size="sm" loading={busy} disabled={!outcome} onClick={() => void save()}>
                                {t("mentor.save")}
                            </PillButtonUI>
                            {audit.evaluation && (
                                <p className="text-sm text-gray-500">
                                    {t("mentor.evaluatedOn", { date: new Date(audit.evaluation.evaluated_at) })}
                                </p>
                            )}
                        </div>
                    </fieldset>
                ) : audit.status === "open" ? (
                    <p className="text-sm text-gray-500">{t("mentor.waiting")}</p>
                ) : null}
            </article>
        </GlassCardUI>
    );
}
