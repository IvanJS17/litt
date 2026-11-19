"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  ObligationRule,
  ProfileExtractionRoute,
  RuleSuggestion,
  RuleSuggestionRun,
  RuleSuggestions as RuleSuggestionsData,
} from "@mike/contracts";
import { Field, SELECT_CLASS } from "@/app/components/requests/requestFields";
import { FormTextInput } from "@/app/components/ui/form-field";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { extractionProviderName } from "@/app/components/profile/profileOptions";
import {
  decideRuleSuggestion,
  decideRuleSuggestions,
  getRuleSuggestionRoute,
  getRuleSuggestions,
  suggestObligationRules,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { useObligationWords } from "./obligationText";
import {
  RuleSuggestionBatchBar,
  SUGGESTION_REASON_MAX,
  SuggestionBatchResult,
  SuggestionCheckbox,
  type SuggestionBatchSummary,
} from "./RuleSuggestionBatchBar";

/** What a run did: how many rules it suggested and why the rest were discarded. */
function RunResult({ result }: { result: RuleSuggestionRun }) {
  const t = useTranslations();
  const id = useId();
  const discarded: [string, number, string][] = [
    ["unknown", result.discarded_unknown_rule, t("radar.rules.suggest.result.discardedUnknown", { count: result.discarded_unknown_rule })],
    ["active", result.discarded_already_active, t("radar.rules.suggest.result.discardedActive", { count: result.discarded_already_active })],
    ["quote", result.discarded_quote_not_found, t("radar.rules.suggest.result.discardedQuote", { count: result.discarded_quote_not_found })],
    ["invalid", result.discarded_invalid, t("radar.rules.suggest.result.discardedInvalid", { count: result.discarded_invalid })],
    ["duplicate", result.discarded_duplicate, t("radar.rules.suggest.result.discardedDuplicate", { count: result.discarded_duplicate })],
  ];
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-1">
      <h4 id={`${id}-title`} className="text-sm font-medium text-gray-900">
        {t("radar.rules.suggest.result.title")}
      </h4>
      <p className="text-sm text-gray-900" role="status">
        {t("radar.rules.suggest.result.suggested", { count: result.suggested })}
      </p>
      {discarded
        .filter(([, count]) => count > 0)
        .map(([key, , text]) => (
          <p key={key} className="text-sm text-gray-600">
            {text}
          </p>
        ))}
      <p className="text-xs text-gray-600">{t("radar.rules.suggest.result.notExhaustive")}</p>
    </section>
  );
}

function SuggestionCard({
  suggestion,
  rule,
  canWrite,
  busy,
  selected,
  onSelect,
  onAccept,
  onDiscard,
  onTurnOn,
}: {
  suggestion: RuleSuggestion;
  rule: ObligationRule | null;
  canWrite: boolean;
  busy: boolean;
  /** null: not part of the batch (decided or out of date). */
  selected: boolean | null;
  onSelect: (checked: boolean) => void;
  onAccept: () => void;
  onDiscard: (reason: string) => void;
  onTurnOn: () => void;
}) {
  const t = useTranslations();
  const id = useId();
  const { ruleName } = useObligationWords();
  const [discarding, setDiscarding] = useState(false);
  const [reason, setReason] = useState("");
  const name = rule ? ruleName(rule.name_key, rule.code) : suggestion.rule_code;
  const obsolete = suggestion.effective_status === "obsolete";
  const accepted = suggestion.status === "accepted" && !obsolete;
  const verified = rule?.verification.status === "verified";
  const statusText = obsolete
    ? t("radar.rules.suggest.status.obsolete", { reason: t(`radar.rules.suggest.stale.${suggestion.stale_reason ?? "text_changed"}`) })
    : accepted
      ? t(rule?.active ? "radar.rules.suggest.status.acceptedActive" : "radar.rules.suggest.status.accepted")
      : t("radar.rules.suggest.status.pending");
  const source = t("radar.rules.suggest.source", {
    name: suggestion.source.filename ?? suggestion.source.document_id,
    version: suggestion.source.version_number ?? "–",
  });
  const stop = () => {
    setDiscarding(false);
    setReason("");
  };
  return (
    <article aria-labelledby={`${id}-name`} className="min-w-0 space-y-2 rounded-xl bg-app-surface/60 p-4">
      <header className="flex items-start gap-3">
        {selected !== null ? <SuggestionCheckbox label={name} checked={selected} disabled={busy} onChange={onSelect} /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <h4 id={`${id}-name`} className="min-w-0 break-words text-sm font-medium text-gray-900">
            {name}
          </h4>
          <p className="text-xs text-gray-500">{t("radar.rules.suggest.aiLabel")}</p>
        </div>
      </header>
      <figure className="space-y-1 border-l-2 border-gray-300 pl-3">
        <figcaption className="text-xs text-gray-500">
          {source}
          {suggestion.page ? ` · ${t("radar.rules.suggest.page", { page: suggestion.page })}` : ""}
        </figcaption>
        <blockquote className="break-words whitespace-pre-wrap text-sm text-gray-700" aria-label={t("radar.rules.suggest.quote")}>
          {suggestion.quote}
        </blockquote>
      </figure>
      <p className="break-words text-xs text-gray-600">
        <span className="font-medium">{t("radar.rules.suggest.reasonLabel")}: </span>
        {suggestion.reason}
      </p>
      <p className={`break-words text-sm ${obsolete ? "text-amber-800" : "text-gray-900"}`}>{statusText}</p>
      {discarding ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-gray-900">
            {t("radar.rules.suggest.discardReason")}
          </label>
          <FormTextInput
            id={`${id}-reason`}
            value={reason}
            maxLength={SUGGESTION_REASON_MAX}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!discarding && !obsolete && suggestion.status === "pending" ? (
            <p className="mr-auto text-xs text-gray-500">{t("radar.rules.suggest.acceptHint")}</p>
          ) : null}
          {discarding ? (
            <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" disabled={busy} onClick={stop}>
              {t("radar.rules.suggest.cancel")}
            </TextButtonUI>
          ) : null}
          <PillButtonUI
            type="button"
            tone="white"
            size="sm"
            className="pointer-coarse:min-h-11"
            disabled={busy}
            onClick={() => {
              if (!discarding) return setDiscarding(true);
              onDiscard(reason.trim());
              stop();
            }}
          >
            {discarding ? t("radar.rules.suggest.discardConfirm") : t("radar.rules.suggest.discard")}
          </PillButtonUI>
          {!discarding && suggestion.status === "pending" && !obsolete ? (
            <PillButtonUI type="button" tone="black" size="sm" className="pointer-coarse:min-h-11" disabled={busy} aria-busy={busy} onClick={onAccept}>
              {busy ? t("radar.rules.suggest.accepting") : t("radar.rules.suggest.accept")}
            </PillButtonUI>
          ) : null}
          {!discarding && accepted && rule && !rule.active && verified ? (
            <PillButtonUI type="button" tone="black" size="sm" className="pointer-coarse:min-h-11" disabled={busy} onClick={onTurnOn}>
              {t("radar.rules.suggest.turnOn")}
            </PillButtonUI>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The AI's rule suggestions inside "Reglas" (docs/obligation-rules.md): the
 * lawyer picks one version of a client document and asks the AI which catalog
 * rules may apply; each suggestion comes with the passage of the document that
 * suggests it, marked "not verified". Accepting opens the existing turn-on form
 * with that rule preselected: no rule is turned on until the lawyer chooses the
 * confirmed date and confirms there. The line under the button says, before the
 * click, where the text goes: the route the chat uses in this space.
 */
export function RuleSuggestions({
  projectId,
  matterId,
  rules,
  onTurnOn,
}: {
  projectId: string;
  matterId: string;
  rules: readonly ObligationRule[];
  /** Opens the turn-on form of this rule (`code@version`). */
  onTurnOn: (ruleKey: string) => void;
}) {
  const t = useTranslations();
  const id = useId();
  const [data, setData] = useState<RuleSuggestionsData | null>(null);
  const [route, setRoute] = useState<ProfileExtractionRoute | null>(null);
  const [failed, setFailed] = useState(false);
  const [versionId, setVersionId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RuleSuggestionRun | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [summary, setSummary] = useState<SuggestionBatchSummary | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const load = useCallback(async () => {
    const next = await getRuleSuggestions(projectId, matterId);
    setData(next);
    setRoute(next.can_write ? await getRuleSuggestionRoute(projectId, matterId).catch(() => null) : null);
    setSelected(new Set());
  }, [projectId, matterId]);

  useEffect(() => {
    let current = true;
    setData(null);
    setFailed(false);
    load().catch((error) => {
      if (!current) return;
      setFailed(true);
      notifyError(error, { action: tRef.current("radar.rules.suggest.couldNotLoad") });
    });
    return () => {
      current = false;
    };
  }, [load]);

  const reload = useCallback(async () => {
    try {
      await load();
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.rules.suggest.couldNotLoad") });
    }
  }, [load]);

  async function run() {
    setRunning(true);
    setResult(null);
    setSummary(null);
    try {
      setResult(await suggestObligationRules(projectId, matterId, versionId));
      await load();
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.rules.suggest.couldNotSuggest") });
    } finally {
      setRunning(false);
    }
  }

  async function accept(suggestion: RuleSuggestion) {
    setBusyId(suggestion.id);
    try {
      await decideRuleSuggestion(projectId, matterId, suggestion.id, "accept");
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.rules.suggest.batch.couldNotDecide") });
      await reload();
      setBusyId(null);
      return;
    }
    // The decision is saved: a failed refresh is reported as a refresh, and the form still opens.
    setSummary(null);
    await reload();
    setBusyId(null);
    // Accepting turns nothing on: it opens the turn-on form, where the lawyer picks the date.
    onTurnOn(suggestion.rule_key);
  }

  async function discard(suggestion: RuleSuggestion, reason: string) {
    setBusyId(suggestion.id);
    try {
      await decideRuleSuggestion(projectId, matterId, suggestion.id, "discard", reason ? { reason } : {});
      setSummary(null);
      await load();
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.rules.suggest.batch.couldNotDecide") });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function decideBatch(decision: "accept" | "discard", reason: string) {
    setBatchBusy(true);
    try {
      const done = await decideRuleSuggestions(projectId, matterId, {
        action: decision,
        suggestionIds: [...selected],
        ...(reason ? { reason } : {}),
      });
      const ok = done.results.filter((one) => one.outcome === "ok").length;
      setSummary({ action: decision, ok, failed: done.results.length - ok });
      await load();
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.rules.suggest.batch.couldNotDecide") });
      await reload();
    } finally {
      setBatchBusy(false);
    }
  }

  const canWrite = data?.can_write === true;
  const ruleOf = (suggestion: RuleSuggestion) => rules.find((rule) => rule.key === suggestion.rule_key) ?? null;
  const shown = (data?.suggestions ?? []).filter((suggestion) => suggestion.effective_status !== "discarded");
  const decidable = shown.filter((suggestion) => suggestion.effective_status === "pending");
  const busy = running || batchBusy || busyId !== null;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="flex items-center gap-2 font-serif text-base text-gray-900">
          <Sparkles aria-hidden="true" className="size-4 shrink-0 text-gray-500" />
          {t("radar.rules.suggest.title")}
        </h3>
        <p className="text-sm text-gray-600">{t("radar.rules.suggest.description")}</p>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          {t("radar.rules.suggest.couldNotLoad")}
        </p>
      ) : !data ? (
        <div aria-busy="true" aria-label={t("radar.rules.suggest.loading")} className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} h-16 animate-pulse`} />
      ) : (
        <>
          {canWrite && route ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-64">
                  <Field id={`${id}-version`} label={t("radar.rules.suggest.version")}>
                    <select
                      id={`${id}-version`}
                      className={SELECT_CLASS}
                      value={versionId}
                      disabled={running}
                      onChange={(event) => setVersionId(event.target.value)}
                    >
                      <option value="">{t("radar.rules.suggest.chooseVersion")}</option>
                      {data.versions.map((version) => (
                        <option key={version.version_id} value={version.version_id}>
                          {t("radar.rules.suggest.source", { name: version.filename ?? version.document_id, version: version.version_number ?? "–" })}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <PillButtonUI
                  type="button"
                  tone="black"
                  size="normal"
                  className="pointer-coarse:min-h-11"
                  disabled={versionId === "" || busy}
                  aria-busy={running}
                  aria-describedby={`${id}-helper`}
                  onClick={() => void run()}
                >
                  {running ? t("radar.rules.suggest.running") : t("radar.rules.suggest.button")}
                </PillButtonUI>
              </div>
              <p id={`${id}-helper`} className="text-xs text-gray-600">
                {t("radar.rules.suggest.helper", { provider: extractionProviderName(route.provider) })}
              </p>
            </div>
          ) : !canWrite ? (
            <p className="text-xs text-gray-500">{t("radar.rules.suggest.readOnly")}</p>
          ) : null}
          {result ? <RunResult result={result} /> : null}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-900">{t("radar.rules.suggest.listTitle")}</h4>
            {canWrite && decidable.length >= 2 ? (
              <RuleSuggestionBatchBar
                total={decidable.length}
                selected={decidable.filter((suggestion) => selected.has(suggestion.id)).length}
                busy={busy}
                onSelectAll={(checked) => setSelected(new Set(checked ? decidable.map((suggestion) => suggestion.id) : []))}
                onDecide={(action, reason) => void decideBatch(action, reason)}
              />
            ) : null}
            <SuggestionBatchResult summary={summary} />
            {shown.length === 0 ? (
              <p className="text-sm text-gray-500">{t("radar.rules.suggest.empty")}</p>
            ) : (
              <ul className="space-y-3">
                {shown.map((suggestion) => (
                  <li key={suggestion.id}>
                    <SuggestionCard
                      suggestion={suggestion}
                      rule={ruleOf(suggestion)}
                      canWrite={canWrite}
                      busy={busy}
                      selected={canWrite && decidable.length >= 2 && suggestion.effective_status === "pending" ? selected.has(suggestion.id) : null}
                      onSelect={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(suggestion.id);
                          else next.delete(suggestion.id);
                          return next;
                        })
                      }
                      onAccept={() => void accept(suggestion)}
                      onDiscard={(reason) => void discard(suggestion, reason)}
                      onTurnOn={() => onTurnOn(suggestion.rule_key)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
