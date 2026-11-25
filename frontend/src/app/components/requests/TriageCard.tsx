"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  MatterRequestAssignee,
  MatterRequestComplexity,
  MatterRequestDetail,
  MatterRequestType,
  TriageCard as TriageCardData,
  TriageDecisionInput,
  TriageItem,
  TriageUrgency,
} from "@mike/contracts";
import { FormTextInput } from "@/app/components/ui/form-field";
import { decideTriageItem, getMatterRequest, getTriageCard, runTriage } from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import { SELECT_CLASS, useRequestWords } from "./requestFields";
import { REQUEST_COMPLEXITIES } from "./requestOptions";

const URGENCIES: readonly TriageUrgency[] = ["low", "normal", "urgent"];
const POLL_MS = 4_000;
const POLL_LIMIT = 45;
const DRAFT_MAX = 400;

type Props = {
  projectId: string;
  matterId: string;
  request: MatterRequestDetail;
  types: MatterRequestType[];
  assignees: MatterRequestAssignee[];
  /** The server's answer after any change to the request, so the list and the detail agree. */
  onChanged: (next: MatterRequestDetail) => void;
  /** Another change came first: read the request again. */
  onStale: () => void;
};

/** The body of a decision. (`action` here is the decision, not a failure toast's phrase.) */
const decision = (action: TriageDecisionInput["action"], rest: Omit<TriageDecisionInput, "action"> = {}): TriageDecisionInput => ({ action, ...rest });

type Edit = { itemId: string; value: string; text: string; purpose: string };

/**
 * Donna's card inside a request: what Jev classified (type, complexity, urgency,
 * candidate lawyer) and what the firm's own AI drafted (strategy, follow-up
 * questions, documents to draft), each one a proposal the lawyer accepts, edits
 * or discards. Nothing here is applied by itself, nothing is assigned and
 * nothing goes to the client (docs/request-triage.md). People in training read
 * the card and cannot decide on it.
 */
export function TriageCard({ projectId, matterId, request, types, assignees, onChanged, onStale }: Props) {
  const t = useTranslations();
  const words = useRequestWords();
  const id = useId();
  const [card, setCard] = useState<TriageCardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [capReached, setCapReached] = useState<"monthly" | "daily" | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  // Read the card; while a run is under way, again every few seconds.
  const requestId = request.id;
  const pending = card?.pending === true;
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    const read = () =>
      getTriageCard(projectId, matterId, requestId).then(
        (next) => {
          if (!current) return;
          setCard(next);
          setFailed(false);
          if (next.pending && polls < POLL_LIMIT) {
            polls += 1;
            timer = setTimeout(read, POLL_MS);
          }
        },
        () => {
          if (current) setFailed(true);
        },
      );
    void read();
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, matterId, requestId, attempt, pending, request.round_count]);

  const refreshRequest = useCallback(async () => {
    onChanged(await getMatterRequest(projectId, matterId, requestId));
  }, [projectId, matterId, requestId, onChanged]);

  async function act(itemId: string, input: TriageDecisionInput, changesRequest: boolean) {
    if (busy) return;
    setBusy(itemId);
    setRefused(null);
    try {
      const next = await decideTriageItem(projectId, matterId, requestId, itemId, input);
      setCard(next);
      setEdit(null);
      if (changesRequest) await refreshRequest();
    } catch (error) {
      const code = errorCode(error);
      if (code === "request_version_conflict") onStale();
      else if (code === "triage_item_decided" || code === "triage_item_obsolete") {
        setAttempt((n) => n + 1);
        setRefused(tRef.current("donna.card.alreadyDecided"));
      } else notifyError(error, { action: tRef.current("donna.card.couldNotSave") });
    } finally {
      setBusy(null);
    }
  }

  async function runAgain() {
    if (busy) return;
    setBusy("run");
    setCapReached(null);
    setRefused(null);
    try {
      setCard(await runTriage(projectId, matterId, requestId));
    } catch (error) {
      if (errorCode(error) === "donna_monthly_cap") setCapReached("monthly");
      else if (errorCode(error) === "donna_daily_cap") setCapReached("daily");
      else if (errorCode(error) === "donna_disabled") setAttempt((n) => n + 1);
      else notifyError(error, { action: tRef.current("donna.card.couldNotRun") });
    } finally {
      setBusy(null);
    }
  }

  const typeById = (typeId: string | null) => types.find((one) => one.id === typeId);
  const valueOf = (item: TriageItem): string => {
    if (item.kind === "type") {
      const one = typeById(item.type_id);
      return one ? words.type(one) : t("donna.card.unknownValue");
    }
    if (item.kind === "complexity") return words.complexity(item.enum_value as MatterRequestComplexity);
    if (item.kind === "urgency") return t(`donna.urgency.${item.enum_value as TriageUrgency}`);
    if (item.kind === "candidate")
      return item.user_label ?? words.person(assignees.find((one) => one.user_id === item.user_id));
    return item.text ?? "";
  };
  const decidedValue = (item: TriageItem): string | null => {
    const decision = item.decision;
    if (!decision) return null;
    if (decision.action === "discarded") return t("donna.card.discarded");
    if (decision.action === "accepted") return t("donna.card.accepted");
    if (item.kind === "type") return t("donna.card.editedTo", { value: words.type(typeById(decision.edited_type_id) ?? { name: null, seed_key: null }) });
    if (item.kind === "complexity") return t("donna.card.editedTo", { value: words.complexity(decision.edited_enum as MatterRequestComplexity) });
    if (item.kind === "urgency") return t("donna.card.editedTo", { value: t(`donna.urgency.${decision.edited_enum as TriageUrgency}`) });
    if (item.kind === "candidate")
      return t("donna.card.editedTo", { value: words.person(assignees.find((one) => one.user_id === decision.edited_user_id)) });
    return t("donna.card.editedTo", { value: decision.edited_text ?? "" });
  };

  function startEdit(item: TriageItem) {
    const initial =
      item.kind === "type"
        ? (item.type_id ?? request.type_id)
        : item.kind === "complexity"
          ? (item.enum_value ?? request.complexity)
          : item.kind === "urgency"
            ? (item.enum_value ?? "normal")
            : item.kind === "candidate"
              ? (item.user_id ?? assignees[0]?.user_id ?? "")
              : "";
    setEdit({ itemId: item.id, value: initial, text: item.text ?? "", purpose: item.purpose ?? "" });
  }

  function submitEdit(item: TriageItem, current: Edit) {
    const input = decision("edited");
    if (item.kind === "type") Object.assign(input, { type_id: current.value, version: request.version });
    else if (item.kind === "complexity") Object.assign(input, { complexity: current.value, version: request.version });
    else if (item.kind === "urgency") Object.assign(input, { urgency: current.value });
    else if (item.kind === "candidate") Object.assign(input, { user_id: current.value });
    else Object.assign(input, { text: current.text, ...(item.kind === "document" ? { purpose: current.purpose } : {}) });
    void act(item.id, input, item.kind === "type" || item.kind === "complexity");
  }

  function actions(item: TriageItem) {
    if (!card?.can_decide || item.decision) return null;
    const changes = item.kind === "type" || item.kind === "complexity";
    const working = busy === item.id;
    return (
      <span className="flex flex-wrap gap-x-3">
        <TextButtonUI
          type="button"
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={busy !== null}
          aria-busy={working}
          onClick={() => void act(item.id, decision("accepted", changes ? { version: request.version } : {}), changes)}
        >
          {t("donna.card.accept")}
        </TextButtonUI>
        <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => startEdit(item)}>
          {t("donna.card.edit")}
        </TextButtonUI>
        <TextButtonUI
          type="button"
          size="sm"
          className="pointer-coarse:min-h-11"
          disabled={busy !== null}
          onClick={() => void act(item.id, decision("discarded"), false)}
        >
          {t("donna.card.discard")}
        </TextButtonUI>
      </span>
    );
  }

  function editor(item: TriageItem) {
    if (!edit || edit.itemId !== item.id) return null;
    const field = `${id}-edit-${item.id}`;
    const draft = item.kind === "strategy" || item.kind === "question" || item.kind === "document";
    return (
      <div className="mt-2 space-y-2">
        {item.kind === "type" ? (
          <select id={field} aria-label={t("requests.fields.type")} className={SELECT_CLASS} value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })}>
            {types
              .filter((one) => !one.archived)
              .map((one) => (
                <option key={one.id} value={one.id}>
                  {words.type(one)}
                </option>
              ))}
          </select>
        ) : null}
        {item.kind === "complexity" ? (
          <select id={field} aria-label={t("requests.fields.complexity")} className={SELECT_CLASS} value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })}>
            {REQUEST_COMPLEXITIES.map((one) => (
              <option key={one} value={one}>
                {words.complexity(one)}
              </option>
            ))}
          </select>
        ) : null}
        {item.kind === "urgency" ? (
          <select id={field} aria-label={t("donna.card.urgency")} className={SELECT_CLASS} value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })}>
            {URGENCIES.map((one) => (
              <option key={one} value={one}>
                {t(`donna.urgency.${one}`)}
              </option>
            ))}
          </select>
        ) : null}
        {item.kind === "candidate" ? (
          <select id={field} aria-label={t("donna.card.candidate")} className={SELECT_CLASS} value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })}>
            {assignees.map((one) => (
              <option key={one.user_id} value={one.user_id}>
                {words.person(one)}
              </option>
            ))}
          </select>
        ) : null}
        {draft ? (
          <>
            <FormTextInput
              id={field}
              aria-label={item.kind === "document" ? t("donna.card.documentName") : t("donna.card.text")}
              value={edit.text}
              maxLength={item.kind === "document" ? 120 : DRAFT_MAX}
              onChange={(event) => setEdit({ ...edit, text: event.target.value })}
            />
            {item.kind === "document" ? (
              <FormTextInput
                aria-label={t("donna.card.documentPurpose")}
                value={edit.purpose}
                maxLength={DRAFT_MAX}
                onChange={(event) => setEdit({ ...edit, purpose: event.target.value })}
              />
            ) : null}
          </>
        ) : null}
        <div className="flex flex-wrap gap-x-3">
          <TextButtonUI
            type="button"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy !== null || (draft && edit.text.trim() === "") || (item.kind === "document" && edit.purpose.trim() === "")}
            onClick={() => submitEdit(item, edit)}
          >
            {t("donna.card.saveEdit")}
          </TextButtonUI>
          <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={busy !== null} onClick={() => setEdit(null)}>
            {t("donna.card.cancelEdit")}
          </TextButtonUI>
        </div>
      </div>
    );
  }

  const heading = (
    <h3 id={`${id}-title`} className="text-sm font-medium text-gray-900">
      {t("donna.card.title")}
    </h3>
  );

  if (failed && !card)
    return (
      <section aria-labelledby={`${id}-title`} className="space-y-2">
        {heading}
        <p role="alert" className="text-sm text-red-700">
          {t("donna.card.couldNotLoad")}
        </p>
        <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" onClick={() => setAttempt((n) => n + 1)}>
          {t("donna.card.retry")}
        </TextButtonUI>
      </section>
    );

  if (!card)
    return (
      <section aria-labelledby={`${id}-title`} aria-busy="true" className="space-y-2">
        {heading}
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
      </section>
    );

  const run = card.run;
  const items = card.items;
  const classification = (kind: TriageItem["kind"]) => items.find((item) => item.kind === kind);
  const drafts = (kind: TriageItem["kind"]) => items.filter((item) => item.kind === kind);
  const rows: { kind: "type" | "complexity" | "urgency" | "candidate"; label: string }[] = [
    { kind: "type", label: t("requests.fields.type") },
    { kind: "complexity", label: t("requests.fields.complexity") },
    { kind: "urgency", label: t("donna.card.urgency") },
    { kind: "candidate", label: t("donna.card.candidate") },
  ];
  const capFull = card.usage.used >= card.usage.limit;

  function line(item: TriageItem, body: React.ReactNode) {
    const decided = decidedValue(item);
    return (
      <li key={item.id} className="min-w-0 space-y-0.5">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 break-words text-sm text-gray-900">{body}</div>
          {decided ? <span className="text-xs text-gray-600">{decided}</span> : actions(item)}
        </div>
        {editor(item)}
      </li>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        {heading}
        <p className="text-xs text-gray-600">{t("donna.card.usage", { used: card.usage.used, limit: card.usage.limit })}</p>
      </div>
      <p className="text-xs text-gray-600">{t("donna.card.proposalsOnly")}</p>

      {card.pending ? (
        <p role="status" aria-live="polite" className="text-sm text-gray-600">
          {t("donna.card.analysing")}
        </p>
      ) : null}

      {!run && !card.pending ? (
        <p className="text-sm text-gray-600">
          {!card.enabled ? t("donna.card.off") : capFull ? t("donna.card.capReached") : t("donna.card.noRun")}
        </p>
      ) : null}

      {run ? (
        <>
          <p className="text-xs text-gray-600">
            {run.docs_total === 0
              ? t("donna.card.noDocuments")
              : t("donna.card.read", { read: run.docs_read, total: run.docs_total })}
            {run.docs_partial > 0 ? ` ${t("donna.card.partial")}` : ""}
          </p>
          {run.unread.length > 0 ? (
            <p className="break-words text-xs text-gray-600">
              {t("donna.card.unread", { names: run.unread.map((one) => one.filename ?? t("requests.rounds.unnamed")).join(", ") })}
            </p>
          ) : null}
          {run.quotes_rejected > 0 ? (
            <p className="text-xs text-gray-600">{t("donna.card.quotesRejected", { count: run.quotes_rejected })}</p>
          ) : null}

          {run.classify_status !== "ok" && !classification("urgency") ? (
            <p role="status" className="text-sm text-gray-900">
              {t("donna.card.classificationUnavailable")}
            </p>
          ) : null}

          {rows.some((row) => classification(row.kind)) || run.classify_status === "ok" ? (
            <ul className="space-y-2">
              {rows.map((row) => {
                const item = classification(row.kind);
                if (!item)
                  return run.classify_status === "ok" && row.kind === "type" ? (
                    <li key={row.kind} className="text-sm text-gray-600">
                      {t("donna.card.noType")}
                    </li>
                  ) : null;
                const same =
                  (row.kind === "type" && item.type_id === request.type_id) ||
                  (row.kind === "complexity" && item.enum_value === request.complexity);
                return line(
                  item,
                  <>
                    <span className="font-medium">{row.label}: </span>
                    {valueOf(item)}
                    {same ? <span className="text-gray-600"> · {t("donna.card.sameAsNow")}</span> : null}
                    {item.low_confidence ? <span className="text-gray-600"> · {t("donna.card.lowConfidence")}</span> : null}
                    {item.forced_by_alarm ? <span className="text-gray-600"> · {t("donna.card.alarm")}</span> : null}
                  </>,
                );
              })}
            </ul>
          ) : null}

          <p className="text-sm text-gray-600">
            {card.playbooks.length > 0
              ? t("donna.card.playbooks", { names: card.playbooks.map((one) => one.name).join(", ") })
              : t("donna.card.noPlaybook")}
          </p>

          {run.generative_status === "no_key" ? <p className="text-sm text-gray-600">{t("donna.card.noKey")}</p> : null}
          {run.generative_status === "unavailable" || run.generative_status === "invalid" ? (
            <p className="text-sm text-gray-600">{t("donna.card.draftFailed")}</p>
          ) : null}
          {run.generative_status === "empty" ? <p className="text-sm text-gray-600">{t("donna.card.draftEmpty")}</p> : null}

          {drafts("strategy").length > 0 ? (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-900">{t("donna.card.strategy")}</h4>
              <ol className="list-decimal space-y-2 pl-5">
                {drafts("strategy").map((item) =>
                  line(
                    item,
                    <>
                      {item.text}
                      {!item.cited ? null : <span className="text-gray-600"> · {t("donna.card.cited")}</span>}
                    </>,
                  ),
                )}
              </ol>
            </div>
          ) : null}
          {drafts("question").length > 0 ? (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-900">{t("donna.card.questions")}</h4>
              <ul className="list-disc space-y-2 pl-5">{drafts("question").map((item) => line(item, item.text))}</ul>
            </div>
          ) : null}
          {drafts("document").length > 0 ? (
            <div className="space-y-1">
              <h4 className="text-xs font-medium text-gray-900">{t("donna.card.documents")}</h4>
              <ul className="list-disc space-y-2 pl-5">
                {drafts("document").map((item) =>
                  line(
                    item,
                    <>
                      <span className="font-medium">{item.text}</span>
                      {item.purpose ? <span>: {item.purpose}</span> : null}
                      {item.playbook ? <span className="text-gray-600"> · {t("donna.card.withPlaybook", { name: item.playbook.name })}</span> : null}
                    </>,
                  ),
                )}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {refused ? (
        <p role="alert" className="text-sm text-red-700">
          {refused}
        </p>
      ) : null}
      {capReached ? (
        <p role="alert" className="text-sm text-red-700">
          {t(capReached === "daily" ? "donna.card.dailyCapReached" : "donna.card.capReached")}
        </p>
      ) : null}
      {!card.can_decide && run ? <p className="text-xs text-gray-500">{t("donna.card.readOnly")}</p> : null}

      {card.can_decide && card.enabled ? (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <span className="text-xs text-gray-600">{t("donna.card.runCounts")}</span>
          <PillButtonUI
            type="button"
            tone="white"
            size="normal"
            className="pointer-coarse:min-h-11"
            disabled={busy !== null || card.pending}
            aria-busy={busy === "run"}
            onClick={() => void runAgain()}
          >
            {busy === "run" ? t("donna.card.running") : run ? t("donna.card.runAgain") : t("donna.card.run")}
          </PillButtonUI>
        </div>
      ) : null}
    </section>
  );
}
