"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import type { RetainerReport, RetainerReportDays, RetainerReportLocale, RetainerReportSentList } from "@mike/contracts";
import { MatterSectionNav } from "@/app/components/profile/MatterSectionNav";
import { useRadarWords } from "@/app/components/radar/radarText";
import { SELECT_CLASS } from "@/app/components/requests/requestFields";
import { EmptyState } from "@/app/components/ui/empty-state";
import { FormTextInput } from "@/app/components/ui/form-field";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { downloadBlob } from "@/app/lib/downloadDocument";
import { downloadRetainerReport, getReportSentHistory, getRetainerReport, markReportSent } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { ReportPreview } from "./ReportPreview";
import { DEFAULT_REPORT_DAYS, isReportDays, NOTE_MAX, REPORT_DAYS } from "./reportOptions";

/**
 * The retainer report of a matter (docs/retainer-report.md): the document a
 * lawyer sends to the client. The page shows what it will say, downloads it as
 * a Word file and lets the lawyer record that they sent it. LiTT sends nothing.
 * Owners and editors generate it; every member reads who marked it as sent.
 */
export function MatterReport({ projectId, matterId }: { projectId: string; matterId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const { day } = useRadarWords();
  const locale = useLocale() as RetainerReportLocale;
  const periodId = useId();
  const noteId = useId();
  const [days, setDays] = useState<RetainerReportDays>(DEFAULT_REPORT_DAYS);
  const [history, setHistory] = useState<RetainerReportSentList | null>(null);
  const [report, setReport] = useState<RetainerReport | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [marking, setMarking] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState("");
  const [justMarked, setJustMarked] = useState(false);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  // The history is for every member; it also says whether the caller may generate the report.
  useEffect(() => {
    let current = true;
    setHistory(null);
    setLoadFailed(false);
    getReportSentHistory(projectId, matterId).then(
      (next) => {
        if (current) setHistory(next);
      },
      (error) => {
        if (!current) return;
        setLoadFailed(true);
        notifyError(error, { action: tRef.current("retainerReport.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, matterId, reload]);

  const canGenerate = history?.retainer === true && history.can_write;
  useEffect(() => {
    if (!canGenerate) return;
    let current = true;
    setReport(null);
    getRetainerReport(projectId, matterId, days, locale).then(
      (next) => {
        if (current) setReport(next);
      },
      (error) => {
        if (!current) return;
        setLoadFailed(true);
        notifyError(error, { action: tRef.current("retainerReport.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
  }, [canGenerate, projectId, matterId, days, locale, reload]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await getReportSentHistory(projectId, matterId));
    } catch (error) {
      notifyError(error, { action: tRef.current("retainerReport.sent.couldNotLoad") });
    }
  }, [projectId, matterId]);

  async function download() {
    setDownloading(true);
    try {
      const file = await downloadRetainerReport(projectId, matterId, days, locale);
      downloadBlob(file.blob, file.filename ?? `report-${days}d.docx`);
    } catch (error) {
      notifyError(error, { action: t("retainerReport.actions.couldNotDownload") });
    } finally {
      setDownloading(false);
    }
  }

  async function mark() {
    setSending(true);
    try {
      await markReportSent(projectId, matterId, days, note.trim() ? { note: note.trim() } : {});
      setMarking(false);
      setNote("");
      setJustMarked(true);
      await refreshHistory();
    } catch (error) {
      notifyError(error, { action: t("retainerReport.actions.couldNotMark") });
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-full px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-block rounded text-xs text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("retainerReport.backToMatter")}
          </Link>
          <MatterSectionNav projectId={projectId} matterId={matterId} current="report" />
          <div className="min-w-0">
            <h1 className="font-serif text-2xl text-gray-900">{t("retainerReport.title")}</h1>
            <p className="mt-1 text-sm text-gray-600">{t("retainerReport.subtitle")}</p>
            <p className="mt-1 text-sm font-medium text-gray-900">{t("retainerReport.disclaimer")}</p>
          </div>
        </header>

        {loadFailed ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} role="alert">
            <p className="text-sm text-red-700">{t("retainerReport.couldNotLoad")}</p>
            <PillButtonUI
              type="button"
              tone="white"
              size="sm"
              onClick={() => {
                setLoadFailed(false);
                setReload((value) => value + 1);
              }}
            >
              {t("retainerReport.retry")}
            </PillButtonUI>
          </section>
        ) : !history ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} aria-busy="true" aria-label={t("retainerReport.loading")}>
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2" aria-hidden="true">
                <div className="h-4 w-1/3 animate-pulse rounded bg-app-surface" />
                <div className="h-16 w-full animate-pulse rounded bg-app-surface" />
              </div>
            ))}
          </section>
        ) : !history.retainer ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}>
            <EmptyState
              icon={<FileText />}
              title={t("retainerReport.retainer.offTitle")}
              description={t("retainerReport.retainer.offDescription")}
            />
          </section>
        ) : (
          <div className="space-y-5">
            {history.can_write ? (
              <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-4 p-5`}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={periodId} className="block text-xs font-medium text-gray-900">
                      {t("retainerReport.period.label")}
                    </label>
                    <select
                      id={periodId}
                      className={SELECT_CLASS}
                      value={days}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (isReportDays(next)) {
                          setDays(next);
                          setJustMarked(false);
                        }
                      }}
                    >
                      {REPORT_DAYS.map((option) => (
                        <option key={option} value={option}>
                          {t("retainerReport.period.option", { days: option })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <PillButtonUI type="button" tone="white" size="sm" disabled={!report || downloading} onClick={() => void download()}>
                      {downloading ? t("retainerReport.actions.downloading") : t("retainerReport.actions.download")}
                    </PillButtonUI>
                    <PillButtonUI type="button" tone="white" size="sm" disabled={!report || marking} onClick={() => setMarking(true)}>
                      {t("retainerReport.actions.markSent")}
                    </PillButtonUI>
                  </div>
                </div>
                <p className="text-xs text-gray-500">{t("retainerReport.sendsNothing")}</p>
                {marking ? (
                  <div className="space-y-2">
                    <label htmlFor={noteId} className="block text-xs font-medium text-gray-900">
                      {t("retainerReport.actions.noteLabel")}
                    </label>
                    <FormTextInput
                      id={noteId}
                      value={note}
                      maxLength={NOTE_MAX}
                      disabled={sending}
                      aria-describedby={`${noteId}-help`}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <p id={`${noteId}-help`} className="text-xs text-gray-500">
                      {t("retainerReport.actions.noteHelp")}
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <PillButtonUI
                        type="button"
                        tone="white"
                        size="sm"
                        disabled={sending}
                        onClick={() => {
                          setMarking(false);
                          setNote("");
                        }}
                      >
                        {t("retainerReport.actions.cancel")}
                      </PillButtonUI>
                      <PillButtonUI type="button" tone="black" size="sm" disabled={sending} onClick={() => void mark()}>
                        {sending ? t("retainerReport.actions.sending") : t("retainerReport.actions.confirmSent")}
                      </PillButtonUI>
                    </div>
                  </div>
                ) : null}
                {justMarked ? (
                  <p role="status" className="text-sm text-gray-900">
                    {t("retainerReport.actions.marked")}
                  </p>
                ) : null}
                {report ? (
                  <ReportPreview report={report} />
                ) : (
                  <div aria-busy="true" aria-label={t("retainerReport.loading")} className="space-y-2">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-app-surface" />
                    <div className="h-24 w-full animate-pulse rounded bg-app-surface" />
                  </div>
                )}
              </section>
            ) : (
              <p className="text-sm text-gray-600">{t("retainerReport.readOnly")}</p>
            )}

            <section aria-labelledby="report-sent" className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`}>
              <h2 id="report-sent" className="font-serif text-lg text-gray-900">
                {t("retainerReport.sent.title")}
              </h2>
              {history.sent.length === 0 ? (
                <p className="text-sm text-gray-600">{t("retainerReport.sent.none")}</p>
              ) : (
                <ul className="space-y-3">
                  {history.sent.map((entry) => (
                    <li key={entry.id} className="min-w-0 space-y-0.5 text-sm text-gray-800">
                      <p className="break-words">
                        {t("retainerReport.sent.entry", {
                          name: entry.sent_by_name ?? t("retainerReport.sent.unknownPerson"),
                          date: format.dateTime(new Date(entry.created_at), { dateStyle: "medium", timeStyle: "short" }),
                        })}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t("retainerReport.sent.period", { start: day(entry.period_start), end: day(entry.period_end) })}
                      </p>
                      {entry.note ? <p className="break-words text-xs text-gray-600">{t("retainerReport.sent.note", { note: entry.note })}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

export default MatterReport;
