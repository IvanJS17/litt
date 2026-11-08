"use client";

// LiTT training, layer 3: from correction to rule. A mentor who edits the
// playbook and supervises someone adds what they corrected in that person's
// work; the server proposes general rules, which wait here for the editor to
// accept or reject each one (nothing changes before that). What the mentor
// writes is sent as written; the rest is catalog text. The pupil is chosen
// here and never shown on a rule: the attribution is the mentor's.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { ModalFieldLabel } from "@/app/components/modals/ModalFieldLabel";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ModalTextarea } from "@/app/components/modals/ModalTextarea";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { showToast } from "@/app/components/ui/toast";
import {
  decidePlaybookChange,
  getPlaybookImport,
  listPlaybookChanges,
  startPlaybookCorrections,
  type Playbook,
  type PlaybookChange,
  type PlaybookCorrectionInput,
  type PlaybookImport,
  type PlaybookPosition,
  type PlaybookRule,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/** The server accepts up to this many corrections in one batch. */
export const MAX_CORRECTIONS = 10;
const POLL_MS = 2_000;
const EMPTY: PlaybookCorrectionInput = { before: "", after: "", comment: "" };

export type CorrectionPupil = { userId: string; label: string };

function positionLines(positions: PlaybookPosition[]): string[] {
  return positions.map((position) =>
    [position.name, position.criteria].filter(Boolean).join(": "),
  );
}

/** The rule's own text, section by section; empty sections are left out. */
function ruleSections(rule: PlaybookRule): { key: string; lines: string[] }[] {
  const sections = [
    { key: "name", lines: [rule.name] },
    { key: "concept", lines: [rule.concept] },
    { key: "guidance", lines: [rule.guidance] },
    {
      key: "standard",
      lines: rule.standard
        ? [
            ...positionLines([rule.standard]),
            ...rule.standard.sampleClauses.map((clause) => clause.text),
          ]
        : [],
    },
    { key: "fallbacks", lines: positionLines(rule.fallbacks) },
    { key: "unacceptable", lines: positionLines(rule.unacceptable) },
    { key: "conditions", lines: rule.conditions },
    {
      key: "actions",
      lines: rule.actions.map((action) =>
        [action.scenario, action.instruction].filter(Boolean).join(": "),
      ),
    },
  ];
  return sections
    .map((section) => ({ ...section, lines: section.lines.filter((line) => line.trim()) }))
    .filter((section) => section.lines.length > 0);
}

function RuleText({ rule, label }: { rule: PlaybookRule | null; label: string }) {
  const t = useTranslations("training.criterion.corrections");
  return (
    <section aria-label={label} className="min-w-0 flex-1 basis-64 space-y-2">
      <h4 className="text-xs font-medium text-gray-700">{label}</h4>
      {rule ? (
        ruleSections(rule).map((section) => (
          <div key={section.key} className="text-xs text-gray-600">
            <p className="font-medium text-gray-800">
              {t(`fields.${section.key}` as "fields.name")}
            </p>
            {section.lines.map((line, index) => (
              <p
                key={`${index}:${line}`}
                className="whitespace-pre-line [overflow-wrap:anywhere]"
              >
                {line}
              </p>
            ))}
          </div>
        ))
      ) : (
        <p className="text-xs text-gray-500">{t("none")}</p>
      )}
    </section>
  );
}

function ChangeCard({
  change,
  deciding,
  onDecide,
}: {
  change: PlaybookChange;
  deciding: boolean;
  onDecide: (decision: "accept" | "reject") => void;
}) {
  const t = useTranslations("training.criterion.corrections");
  const rule = change.after ?? change.before;
  const attributed = change.after?.origin?.attributedTo;
  return (
    <li className="space-y-3 rounded-lg border border-gray-200 p-4">
      <header className="space-y-0.5">
        <p className="text-xs text-gray-500">{t(`op.${change.op}`)}</p>
        <h3 className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
          {rule?.name}
        </h3>
        <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
          {attributed ? t("source", { name: attributed }) : t("sourceUnnamed")}
        </p>
      </header>
      {change.rationale && (
        <p className="text-xs text-gray-600 [overflow-wrap:anywhere]">
          <span className="font-medium text-gray-800">{t("why")}: </span>
          {change.rationale}
        </p>
      )}
      <div className="flex flex-wrap gap-4">
        <RuleText rule={change.before} label={t("beforeRule")} />
        <RuleText rule={change.after} label={t("afterRule")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PillButtonUI tone="black" disabled={deciding} onClick={() => onDecide("accept")}>
          {t("accept")}
        </PillButtonUI>
        <PillButtonUI tone="white" disabled={deciding} onClick={() => onDecide("reject")}>
          {t("reject")}
        </PillButtonUI>
      </div>
    </li>
  );
}

export function PlaybookCorrections({
  playbookId,
  pupils,
  models,
  model,
  onModelChange,
  disabled = false,
  onPlaybookChanged,
}: {
  playbookId: string;
  /** The caller's current pupils, named for the list. */
  pupils: CorrectionPupil[];
  models: { value: string; label: string }[];
  model: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  /** An accepted change rewrote the rules: the page shows the saved playbook. */
  onPlaybookChanged: (playbook: Playbook) => void;
}) {
  const t = useTranslations("training.criterion.corrections");
  const ids = { pupil: useId(), model: useId(), intro: useId() };
  const [pupilId, setPupilId] = useState("");
  const [rows, setRows] = useState<PlaybookCorrectionInput[]>([{ ...EMPTY }]);
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState<PlaybookImport | null>(null);
  const [changes, setChanges] = useState<PlaybookChange[] | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const all = await listPlaybookChanges(playbookId);
      if (alive.current) setChanges(all.filter((change) => change.status === "pending"));
    } catch (err) {
      if (alive.current) setChanges([]);
      notifyError(err, { action: t("loadAction"), operation: "playbooks.save" });
    }
  }, [playbookId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow the batch until it ends; its changes then appear in the list.
  const attemptId = attempt?.status === "running" ? attempt.id : null;
  useEffect(() => {
    if (!attemptId) return;
    const timer = setInterval(() => {
      void getPlaybookImport(attemptId)
        .then((next) => {
          if (!alive.current || next.status === "running") return;
          setAttempt(next);
          if (next.status === "completed") void load();
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [attemptId, load]);

  const pending = changes?.length ?? 0;
  const running = attempt?.status === "running";
  const complete = rows.every((row) => row.after.trim());
  const canSend =
    !disabled && !sending && !running && pending === 0 && !!pupilId && !!model && complete;

  function setRow(index: number, patch: Partial<PlaybookCorrectionInput>) {
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      const started = await startPlaybookCorrections(playbookId, {
        model,
        traineeUserId: pupilId,
        corrections: rows.map((row) => ({
          before: row.before.trim(),
          after: row.after.trim(),
          comment: row.comment.trim(),
        })),
      });
      setAttempt(started);
      setRows([{ ...EMPTY }]);
    } catch (err) {
      notifyError(err, { action: t("sendAction"), operation: "playbooks.import" });
    } finally {
      setSending(false);
    }
  }

  async function decide(change: PlaybookChange, decision: "accept" | "reject") {
    setDecidingId(change.id);
    try {
      const result = await decidePlaybookChange(playbookId, change.id, decision);
      showToast({
        tone: "success",
        title: t(decision === "accept" ? "accepted" : "rejected"),
        message: result.change.after?.name ?? result.change.before?.name ?? "",
      });
      if (decision === "accept") onPlaybookChanged(result.playbook);
      await load();
    } catch (err) {
      notifyError(err, {
        action: t(decision === "accept" ? "acceptAction" : "rejectAction"),
        operation: "playbooks.save",
      });
      // A stale or decided change: the list shows what is pending now.
      await load();
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div className="mx-3 mb-6 min-h-0 flex-1 space-y-8 overflow-y-auto pb-6 md:mx-6.5">
      <section aria-labelledby={ids.intro} className="max-w-3xl space-y-4">
        <div className="space-y-1">
          <h2 id={ids.intro} className="text-sm font-medium text-gray-900">
            {t("title")}
          </h2>
          <p className="text-xs text-gray-600">{t("intro")}</p>
          <p className="text-xs text-gray-500">{t("privacy")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <ModalFieldLabel htmlFor={ids.pupil}>{t("pupil")}</ModalFieldLabel>
            <ModalSelect
              id={ids.pupil}
              value={pupilId}
              placeholder={t("pupilPlaceholder")}
              options={pupils.map((pupil) => ({ value: pupil.userId, label: pupil.label }))}
              onChange={setPupilId}
              disabled={disabled || sending || running}
            />
          </div>
          <div>
            <ModalFieldLabel htmlFor={ids.model}>{t("model")}</ModalFieldLabel>
            <ModalSelect
              id={ids.model}
              value={model}
              options={models}
              onChange={onModelChange}
              disabled={disabled || sending || running}
            />
          </div>
        </div>
        <ol className="space-y-4">
          {rows.map((row, index) => (
            <li key={index}>
              <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4">
                <legend className="px-1 text-xs font-medium text-gray-700">
                  {t("correction", { number: index + 1 })}
                </legend>
                <div>
                  <ModalFieldLabel htmlFor={`${ids.intro}-before-${index}`}>
                    {t("before")}
                  </ModalFieldLabel>
                  <ModalTextarea
                    id={`${ids.intro}-before-${index}`}
                    value={row.before}
                    maxLength={4000}
                    onChange={(event) => setRow(index, { before: event.target.value })}
                  />
                </div>
                <div>
                  <ModalFieldLabel htmlFor={`${ids.intro}-after-${index}`}>
                    {t("after")}
                  </ModalFieldLabel>
                  <ModalTextarea
                    id={`${ids.intro}-after-${index}`}
                    value={row.after}
                    maxLength={4000}
                    onChange={(event) => setRow(index, { after: event.target.value })}
                  />
                </div>
                <div>
                  <ModalFieldLabel htmlFor={`${ids.intro}-comment-${index}`}>
                    {t("comment")}
                  </ModalFieldLabel>
                  <ModalTextarea
                    id={`${ids.intro}-comment-${index}`}
                    value={row.comment}
                    maxLength={1500}
                    className="min-h-16"
                    onChange={(event) => setRow(index, { comment: event.target.value })}
                  />
                </div>
                {rows.length > 1 && (
                  <PillButtonUI
                    tone="white"
                    aria-label={t("remove", { number: index + 1 })}
                    onClick={() =>
                      setRows((current) => current.filter((_, at) => at !== index))
                    }
                  >
                    {t("remove", { number: index + 1 })}
                  </PillButtonUI>
                )}
              </fieldset>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <PillButtonUI
            tone="white"
            disabled={rows.length >= MAX_CORRECTIONS || sending || running}
            onClick={() => setRows((current) => [...current, { ...EMPTY }])}
          >
            {t("add")}
          </PillButtonUI>
          <p className="text-xs text-gray-500">{t("limit", { max: MAX_CORRECTIONS })}</p>
          <PillButtonUI
            tone="black"
            className="ml-auto"
            disabled={!canSend}
            loading={sending}
            onClick={() => void send()}
          >
            {sending ? t("sending") : t("send")}
          </PillButtonUI>
        </div>
        <div role="status" aria-live="polite" className="min-h-5 text-xs text-gray-600">
          {running && <p>{t("running")}</p>}
          {attempt?.status === "failed" && (
            <p className="[overflow-wrap:anywhere]">
              <strong className="font-medium text-gray-800">{t("failed")}</strong>
              {attempt.error ? ` ${attempt.error}` : ""}
            </p>
          )}
          {attempt?.status === "completed" && changes?.length === 0 && (
            <p>{t("noChanges")}</p>
          )}
        </div>
      </section>

      <section aria-labelledby={`${ids.intro}-pending`} className="max-w-3xl space-y-3">
        <h2 id={`${ids.intro}-pending`} className="text-sm font-medium text-gray-900">
          {t("pendingTitle")}
        </h2>
        {changes === null ? (
          <div role="status" aria-label={t("loading")} className="space-y-3">
            {[0, 1].map((key) => (
              <div key={key} className="space-y-2 rounded-lg border border-gray-200 p-4">
                <SkeletonLine className="w-24" />
                <SkeletonLine className="w-1/2" />
                <SkeletonLine className="w-full" />
                <SkeletonLine className="w-3/4" />
              </div>
            ))}
          </div>
        ) : changes.length === 0 ? (
          <p className="text-xs text-gray-500">{t("pendingEmpty")}</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">{t("pendingBlocked")}</p>
            <ul className="space-y-3">
              {changes.map((change) => (
                <ChangeCard
                  key={change.id}
                  change={change}
                  deciding={decidingId !== null}
                  onDecide={(decision) => void decide(change, decision)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
