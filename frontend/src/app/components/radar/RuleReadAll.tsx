"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import type { RuleReadBatchResult, RuleReadDocument, RuleReadPlan, RuleReadSkipped } from "@mike/contracts";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { planRuleRead, readRuleBatch } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

type Totals = {
  suggested: number;
  superseded: number;
  questions: number;
  discarded: number;
  reviewed: number;
  total: number;
  notReviewed: string[];
  stoppedAt: number | null;
  calls: number;
};

const nameOf = (one: { filename: string | null; version_id: string }) => one.filename ?? one.version_id;
const documentsOf = (plan: RuleReadPlan): RuleReadDocument[] => plan.batches.flatMap((batch) => batch.documents);
const discardedOf = (result: RuleReadBatchResult) =>
  result.discarded_unknown_rule +
  result.discarded_already_active +
  result.discarded_quote_not_found +
  result.discarded_duplicate +
  result.discarded_invalid +
  result.discarded_question_invalid;

/**
 * "Leer todos los documentos del cliente" (S8c, docs/obligation-rules.md): the
 * current documents of the matter with ready text, all pre-checked (the lawyer may
 * uncheck some). The server groups WHOLE documents into calls of at most 120,000
 * characters; before the click the help line says how many documents and how many
 * calls go to the provider, from the same plan the run follows. The calls run one
 * after the other with their progress. A document that is too long, or has no
 * text, is listed as not reviewed: nothing is cut. The button is the only trigger.
 */
export function RuleReadAll({
  projectId,
  matterId,
  provider,
  busy,
  onDone,
}: {
  projectId: string;
  matterId: string;
  /** The provider the text would go to (already a display name). */
  provider: string;
  /** Another action of the panel is running. */
  busy: boolean;
  /** Reload what the panel shows once a read ended (also after a failure). */
  onDone: () => Promise<void>;
}) {
  const t = useTranslations();
  const id = useId();
  const [docs, setDocs] = useState<RuleReadDocument[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [plan, setPlan] = useState<RuleReadPlan | null>(null);
  const [planning, setPlanning] = useState(true);
  const [failed, setFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const tRef = useRef(t);
  const seeded = useRef(false);
  useEffect(() => {
    tRef.current = t;
  });

  // The first plan covers every current document and seeds the checked list.
  useEffect(() => {
    let current = true;
    seeded.current = false;
    setDocs(null);
    setPlan(null);
    setFailed(false);
    setPlanning(true);
    planRuleRead(projectId, matterId)
      .then((next) => {
        if (!current) return;
        const all = documentsOf(next);
        setDocs(all);
        setSelected(new Set(all.map((one) => one.version_id)));
        setPlan(next);
        seeded.current = true;
      })
      .catch((error) => {
        if (!current) return;
        setFailed(true);
        notifyError(error, { action: tRef.current("radar.rules.suggest.all.couldNotPlan") });
      })
      .finally(() => {
        if (current) setPlanning(false);
      });
    return () => {
      current = false;
    };
  }, [projectId, matterId]);

  // Every change of the selection asks the server again, so the counts are its own.
  const selectionKey = [...selected].sort().join(",");
  useEffect(() => {
    if (!seeded.current || !docs) return;
    let current = true;
    if (selected.size === 0) {
      setPlan(null);
      return;
    }
    setPlanning(true);
    planRuleRead(projectId, matterId, [...selected])
      .then((next) => {
        if (current) setPlan(next);
      })
      .catch((error) => {
        if (!current) return;
        setPlan(null);
        notifyError(error, { action: tRef.current("radar.rules.suggest.all.couldNotPlan") });
      })
      .finally(() => {
        if (current) setPlanning(false);
      });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const planned = plan ? documentsOf(plan) : [];
  const calls = plan?.batches.length ?? 0;

  async function run() {
    if (!plan || plan.batches.length === 0) return;
    const batches = plan.batches;
    const skipped: RuleReadSkipped[] = plan.skipped;
    const runId = crypto.randomUUID();
    const next: Totals = {
      suggested: 0,
      superseded: 0,
      questions: 0,
      discarded: 0,
      reviewed: 0,
      total: documentsOf(plan).length + skipped.length,
      notReviewed: skipped.map((one) => `${nameOf(one)} (${t(`radar.rules.suggest.all.skipped.${one.reason}`)})`),
      stoppedAt: null,
      calls: batches.length,
    };
    setRunning(true);
    setTotals(null);
    try {
      for (const [index, batch] of batches.entries()) {
        setProgress({ current: index + 1, total: batches.length });
        let result: RuleReadBatchResult;
        try {
          result = await readRuleBatch(projectId, matterId, { runId, versionIds: batch.documents.map((one) => one.version_id) });
        } catch (error) {
          notifyError(error, { action: tRef.current("radar.rules.suggest.all.couldNotRead") });
          next.stoppedAt = index + 1;
          for (const left of batches.slice(index))
            next.notReviewed.push(...left.documents.map((one) => `${nameOf(one)}`));
          break;
        }
        next.suggested += result.suggested;
        next.superseded += result.superseded;
        next.questions += result.questions_asked;
        next.discarded += discardedOf(result);
        next.reviewed += batch.documents.length;
      }
    } finally {
      setTotals(next);
      setProgress(null);
      setRunning(false);
    }
    try {
      await onDone();
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.rules.suggest.couldNotLoad") });
    }
  }

  const disabled = running || busy || planning || !plan || plan.batches.length === 0;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="space-y-1">
        <h4 id={`${id}-title`} className="text-sm font-medium text-gray-900">
          {t("radar.rules.suggest.all.title", { count: docs?.length ?? 0 })}
        </h4>
        <p className="text-sm text-gray-600">{t("radar.rules.suggest.all.description")}</p>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          {t("radar.rules.suggest.all.couldNotPlan")}
        </p>
      ) : docs === null ? (
        <div aria-busy="true" aria-label={t("radar.rules.suggest.all.planning")} className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} h-16 animate-pulse`} />
      ) : docs.length === 0 && (plan?.skipped.length ?? 0) === 0 ? (
        <p className="text-sm text-gray-500">{t("radar.rules.suggest.all.noDocuments")}</p>
      ) : (
        <>
          <fieldset className="space-y-1" disabled={running || busy}>
            <legend className="sr-only">{t("radar.rules.suggest.all.group")}</legend>
            <ul className="space-y-1">
              {docs.map((one) => (
                <li key={one.version_id} className="flex items-start gap-2 text-sm text-gray-900">
                  <input
                    type="checkbox"
                    className={`${TABLE_CHECKBOX_CLASS} mt-1`}
                    aria-label={t("radar.rules.suggest.all.select", { name: nameOf(one) })}
                    checked={selected.has(one.version_id)}
                    onChange={(event) =>
                      setSelected((currentSet) => {
                        const nextSet = new Set(currentSet);
                        if (event.target.checked) nextSet.add(one.version_id);
                        else nextSet.delete(one.version_id);
                        return nextSet;
                      })
                    }
                  />
                  <span className="min-w-0 break-words">
                    {nameOf(one)}
                    <span className="text-xs text-gray-500">
                      {" · "}
                      {t("radar.rules.suggest.all.version", { version: one.version_number ?? "–" })}
                      {" · "}
                      {t("radar.rules.suggest.all.chars", { count: one.chars })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
          {plan && plan.skipped.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-gray-600">
              {plan.skipped.map((one) => (
                <li key={one.version_id} className="break-words">
                  {nameOf(one)} · {t(`radar.rules.suggest.all.skipped.${one.reason}`)}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="space-y-2">
            {selected.size === 0 ? (
              <p id={`${id}-helper`} className="text-xs text-gray-600">
                {t("radar.rules.suggest.all.nothingSelected")}
              </p>
            ) : planning || !plan ? (
              <p id={`${id}-helper`} className="text-xs text-gray-600">
                {t("radar.rules.suggest.all.planning")}
              </p>
            ) : (
              <p id={`${id}-helper`} className="text-xs text-gray-600">
                {t("radar.rules.suggest.all.helper", { n: planned.length, k: calls, provider })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <PillButtonUI
                type="button"
                tone="black"
                size="normal"
                className="pointer-coarse:min-h-11"
                disabled={disabled}
                aria-busy={running}
                aria-describedby={`${id}-helper`}
                onClick={() => void run()}
              >
                {running ? t("radar.rules.suggest.all.running") : t("radar.rules.suggest.all.button")}
              </PillButtonUI>
              {progress ? (
                <p role="status" className="text-sm text-gray-900">
                  {t("radar.rules.suggest.all.progress", progress)}
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}
      {totals ? <ReadResult totals={totals} /> : null}
    </section>
  );
}

function ReadResult({ totals }: { totals: Totals }) {
  const t = useTranslations();
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-1">
      <h5 id={`${id}-title`} className="text-sm font-medium text-gray-900">
        {t("radar.rules.suggest.all.result.title")}
      </h5>
      <p className="text-sm text-gray-900" role="status">
        {t("radar.rules.suggest.all.result.reviewed", { reviewed: totals.reviewed, total: totals.total })}
      </p>
      {totals.notReviewed.length > 0 ? (
        <p className="break-words text-sm text-gray-600">
          {t("radar.rules.suggest.all.result.notReviewed", { names: totals.notReviewed.join("; ") })}
        </p>
      ) : null}
      {totals.stoppedAt ? (
        <p role="alert" className="text-sm text-red-700">
          {t("radar.rules.suggest.all.stoppedAt", { current: totals.stoppedAt, total: totals.calls })}
        </p>
      ) : null}
      <p className="text-sm text-gray-900">{t("radar.rules.suggest.all.result.suggested", { count: totals.suggested })}</p>
      {totals.superseded > 0 ? (
        <p className="text-sm text-gray-600">{t("radar.rules.suggest.all.result.superseded", { count: totals.superseded })}</p>
      ) : null}
      <p className="text-sm text-gray-900">{t("radar.rules.suggest.all.result.questions", { count: totals.questions })}</p>
      {totals.discarded > 0 ? (
        <p className="text-sm text-gray-600">{t("radar.rules.suggest.all.result.discarded", { count: totals.discarded })}</p>
      ) : null}
      <p className="text-xs text-gray-600">{t("radar.rules.suggest.result.notExhaustive")}</p>
    </section>
  );
}
