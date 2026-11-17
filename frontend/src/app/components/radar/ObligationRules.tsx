"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type { MatterObligationRules, ObligationAnchorChoice, ObligationRule, ObligationRuleActivationInput } from "@mike/contracts";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { getMatterObligationRules, setMatterObligationRule } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { useObligationWords } from "./obligationText";
import { useRadarWords } from "./radarText";

/** The citations, notes and the way each date is counted: the same for the list and for the items. */
export function RuleDetails({ rule }: { rule: ObligationRule }) {
  const t = useTranslations();
  const { milestoneText, ruleName } = useObligationWords();
  return (
    <>
      <dl className="space-y-1 text-xs text-gray-600">
        <div>
          <dt className="inline font-medium">{t("radar.rules.appliesWhen")}: </dt>
          <dd className="inline break-words">{ruleName(rule.applies_when_key, rule.code)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">{t("radar.rules.countsFrom")}: </dt>
          <dd className="inline break-words">{ruleName(rule.anchor_key, rule.code)}</dd>
        </div>
      </dl>
      <ul className="space-y-0.5 text-xs text-gray-700">
        {rule.milestones.map((milestone) => (
          <li key={milestone.kind} className="break-words">
            {milestoneText(milestone)}
          </li>
        ))}
      </ul>
      {rule.requires_business_days ? <p className="text-sm text-amber-800">{t("radar.rules.businessDays")}</p> : null}
      {rule.citations.map((citation, index) => (
        <figure key={`${citation.law}:${citation.location}:${index}`} className="space-y-1 border-l-2 border-gray-300 pl-3">
          <figcaption className="text-xs text-gray-500">
            {t("radar.rules.source", { law: citation.law, location: citation.location })}
            {" · "}
            {t("radar.rules.lastReform", { value: citation.last_reform })}
            {citation.url ? (
              <>
                {" · "}
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded underline hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t("radar.rules.openSource")}
                </a>
              </>
            ) : null}
          </figcaption>
          <blockquote className="break-words whitespace-pre-wrap text-sm text-gray-700" aria-label={t("radar.rules.quote")}>
            {citation.text}
          </blockquote>
        </figure>
      ))}
      {rule.notes ? (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-gray-900">{t("radar.rules.notes")}</p>
          <p className="break-words whitespace-pre-wrap text-xs text-gray-600">{rule.notes}</p>
        </div>
      ) : null}
    </>
  );
}

function RuleCard({
  rule,
  choices,
  names,
  canWrite,
  busy,
  onTurn,
}: {
  rule: ObligationRule;
  choices: readonly ObligationAnchorChoice[];
  names: ReadonlyMap<string, string | null>;
  canWrite: boolean;
  busy: boolean;
  onTurn: (on: boolean, input?: ObligationRuleActivationInput) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const id = useId();
  const { day } = useRadarWords();
  const { ruleName, firstCycleFrom } = useObligationWords();
  const [choosing, setChoosing] = useState(false);
  const [factId, setFactId] = useState("");
  const [firstCycle, setFirstCycle] = useState(false);
  const verified = rule.verification.status === "verified";
  const status = rule.active ? "active" : verified ? "off" : "unverified";
  // An unverified rule is shown but cannot be turned on; a rule that is on can always be turned off.
  const cannotTurnOn = !rule.active && !verified;
  const anchor = rule.active && rule.anchor ? (choices.find((choice) => choice.fact_id === rule.anchor!.fact_id) ?? null) : null;
  const from = rule.first_cycle ? firstCycleFrom(rule.first_cycle.from) : "";

  function open() {
    setFactId(rule.anchor?.fact_id ?? "");
    setFirstCycle(rule.anchor?.mode === "first_cycle");
    setChoosing(true);
  }
  function confirm() {
    onTurn(true, { anchor_fact_id: factId, anchor_mode: firstCycle && rule.first_cycle ? "first_cycle" : "direct" });
    setChoosing(false);
  }

  return (
    <article aria-labelledby={`${id}-name`} className="min-w-0 space-y-2 rounded-xl bg-app-surface/60 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 id={`${id}-name`} className="min-w-0 break-words text-sm font-medium text-gray-900">
            {ruleName(rule.name_key, rule.code)}
          </h3>
          <p className="text-xs text-gray-500">
            {t(`radar.rules.kind.${rule.kind}`)} · {t(`radar.rules.status.${status}`)}
          </p>
        </div>
        {canWrite && !choosing ? (
          <div className="flex flex-wrap justify-end gap-2">
            {rule.active ? (
              <PillButtonUI type="button" tone="white" size="sm" className="pointer-coarse:min-h-11" disabled={busy} onClick={open}>
                {t("radar.rules.anchor.change")}
              </PillButtonUI>
            ) : null}
            <PillButtonUI
              type="button"
              tone={rule.active ? "white" : "black"}
              size="sm"
              className="pointer-coarse:min-h-11"
              disabled={busy || cannotTurnOn}
              aria-describedby={cannotTurnOn ? `${id}-why` : undefined}
              aria-busy={busy}
              onClick={rule.active ? () => onTurn(false) : open}
            >
              {busy ? t("radar.rules.working") : rule.active ? t("radar.rules.turnOff") : t("radar.rules.turnOn")}
            </PillButtonUI>
          </div>
        ) : null}
      </header>
      {cannotTurnOn ? (
        <p id={`${id}-why`} className="text-sm text-amber-800">
          {t("radar.rules.unverifiedWhy")}
        </p>
      ) : null}
      {rule.active && rule.anchor ? (
        <p className="break-words text-sm text-gray-900">
          {anchor ? t("radar.rules.anchor.chosen", { label: anchor.label, date: day(anchor.date_on) }) : t("radar.rules.anchor.gone")}
          {rule.anchor.mode === "first_cycle" ? ` · ${t("radar.rules.anchor.modeFirstCycle", { from })}` : ""}
        </p>
      ) : null}
      {choosing ? (
        <div className="space-y-2 rounded-lg bg-app-surface p-3">
          {choices.length === 0 ? (
            <p className="text-sm text-amber-800">{t("radar.rules.anchor.none")}</p>
          ) : (
            <div className="space-y-1">
              <label htmlFor={`${id}-anchor`} className="block text-xs font-medium text-gray-900">
                {t("radar.rules.anchor.label")}
              </label>
              <select
                id={`${id}-anchor`}
                className={`${FORM_CONTROL_GLASS_CLASS} h-10`}
                value={factId}
                onChange={(event) => setFactId(event.target.value)}
              >
                <option value="">{t("radar.rules.anchor.choose")}</option>
                {choices.map((choice) => (
                  <option key={choice.fact_id} value={choice.fact_id}>
                    {t("radar.rules.anchor.option", { label: choice.label, date: day(choice.date_on) })}
                  </option>
                ))}
              </select>
            </div>
          )}
          {rule.first_cycle ? (
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-sm text-gray-900">
                <input type="checkbox" className="mt-1" checked={firstCycle} onChange={(event) => setFirstCycle(event.target.checked)} />
                <span>{t("radar.rules.anchor.firstCycle", { from })}</span>
              </label>
              {rule.first_cycle.only_if ? (
                <p className="text-xs text-gray-600">{t("radar.rules.anchor.onlyIf", { condition: rule.first_cycle.only_if })}</p>
              ) : null}
              {rule.first_cycle.cap_years ? (
                <p className="text-xs text-gray-600">{t("radar.rules.anchor.cap", { years: rule.first_cycle.cap_years })}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" onClick={() => setChoosing(false)}>
              {t("radar.rules.anchor.cancel")}
            </TextButtonUI>
            <PillButtonUI type="button" tone="black" size="sm" className="pointer-coarse:min-h-11" disabled={!factId} onClick={confirm}>
              {t("radar.rules.anchor.confirm")}
            </PillButtonUI>
          </div>
        </div>
      ) : null}
      <RuleDetails rule={rule} />
      {verified && rule.verification.verified_on ? (
        <p className="break-words text-xs text-gray-500">{t("radar.rules.verified", { date: day(rule.consulted_on) })}</p>
      ) : null}
      {rule.changed_by && names.has(rule.changed_by) && rule.changed_at ? (
        <p className="break-words text-xs text-gray-500">
          {names.get(rule.changed_by) ?? t("radar.history.unknownPerson")} ·{" "}
          {format.dateTime(new Date(rule.changed_at), { dateStyle: "medium", timeStyle: "short" })}
        </p>
      ) : null}
    </article>
  );
}

/**
 * The "Reglas" section of the radar (docs/obligation-rules.md): the catalog of
 * obligation rules with their sources, quotes and notes, and whether each is on
 * for this matter and from which confirmed date. Owners and editors turn rules
 * on (choosing that date) and off; a rule no lawyer has verified is listed,
 * disabled, with the reason.
 */
export function ObligationRules({
  projectId,
  matterId,
  onChanged,
}: {
  projectId: string;
  matterId: string;
  /** Called after a rule was turned on or off, so the page reads its items again. */
  onChanged: () => void;
}) {
  const t = useTranslations();
  const [data, setData] = useState<MatterObligationRules | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let current = true;
    setData(null);
    setFailed(false);
    getMatterObligationRules(projectId, matterId).then(
      (next) => {
        if (current) setData(next);
      },
      (error) => {
        if (!current) return;
        setFailed(true);
        notifyError(error, { action: tRef.current("radar.rules.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, matterId]);

  const turn = useCallback(
    async (rule: ObligationRule, on: boolean, input?: ObligationRuleActivationInput) => {
      setBusyKey(rule.key);
      try {
        await setMatterObligationRule(projectId, matterId, rule.key, on, input);
        setData(await getMatterObligationRules(projectId, matterId));
        onChanged();
      } catch (error) {
        notifyError(error, { action: tRef.current("radar.rules.couldNotChange") });
      } finally {
        setBusyKey(null);
      }
    },
    [projectId, matterId, onChanged],
  );

  if (data && !data.retainer) return null;
  const names = new Map((data?.people ?? []).map((person) => [person.user_id, person.name] as const));

  return (
    <section aria-labelledby="radar-rules-title" className="space-y-2">
      <h2 id="radar-rules-title" className="font-serif text-lg text-gray-900">
        {t("radar.rules.title")}
      </h2>
      <p className="text-sm text-gray-600">{t("radar.rules.description")}</p>
      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          {t("radar.rules.couldNotLoad")}
        </p>
      ) : !data ? (
        <div aria-busy="true" aria-label={t("radar.rules.loading")} className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} h-16 animate-pulse`} />
      ) : data.rules.length === 0 ? (
        <p className="text-sm text-gray-500">{t("radar.rules.empty")}</p>
      ) : (
        <>
          {!data.can_write ? <p className="text-xs text-gray-500">{t("radar.rules.readOnly")}</p> : null}
          <ul className="space-y-3">
            {data.rules.map((rule) => (
              <li key={rule.key}>
                <RuleCard
                  rule={rule}
                  choices={data.anchor_choices}
                  names={names}
                  canWrite={data.can_write}
                  busy={busyKey === rule.key}
                  onTurn={(on, input) => void turn(rule, on, input)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
