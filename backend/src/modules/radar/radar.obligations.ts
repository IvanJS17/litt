/**
 * Pure: the radar items of the ACTIVE obligation rules of a matter
 * (docs/obligation-rules.md).
 *
 * Turning a rule on names its anchor: one confirmed `date` fact of the matter,
 * chosen by the lawyer and kept in the activation event. The item is computed
 * on every read from that fact's date:
 *
 *   chain of operations, in order           dated item (a window: its closing day,
 *                                           with `startsOn` the opening day)
 *   business days anywhere                  no date, "to review": never computed
 *   the fact has no usable date             no date, "to review" (missing_date)
 *   the fact is pending, rejected, stale
 *   or gone                                 no date, "to review" (anchor_unavailable)
 *
 * Dates come from radar.dates only: calendar days, months and years over ISO
 * dates, with its end-of-month rule. A model never produces one. There are no
 * chained cycles: a renewal needs the new expiry confirmed as a new fact.
 */

import type { ProfileFact, ProfileFactSource } from "@mike/contracts";
import { addCalendar, endOfMonth, isIsoDate, startOfMonth } from "./radar.dates";
import { countsForRadar, type RadarReviewReason } from "./radar.derive";
import { hasBusinessDays, ruleKey, type ObligationRuleDef, type RuleOp } from "./radar.rules";

export const OBLIGATION_ITEM_TYPE = "obligation_due" as const;
export type AnchorMode = "direct" | "first_cycle";
export const ANCHOR_MODES: readonly AnchorMode[] = ["direct", "first_cycle"];

/** A rule a matter has turned on, with the fact it counts from. */
export type ActiveRule = { rule: ObligationRuleDef; anchorFactId: string; mode: AnchorMode };

export type DerivedObligation = {
  key: string;
  rule: ObligationRuleDef;
  factId: string;
  dueOn: string | null;
  startsOn: string | null;
  /** The date the chain started from (after the first-cycle step, when used). */
  baseOn: string | null;
  reviewReason: RadarReviewReason | null;
  source: ProfileFactSource | null;
  label: string;
};

export const obligationKey = (rule: Pick<ObligationRuleDef, "code" | "version">, anchorFactId: string) =>
  `${ruleKey(rule)}:${anchorFactId}`;

const KEY = /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)@([1-9][0-9]{0,5}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** `<code>@<version>:<anchor fact id>` back into its parts, or null. */
export function parseObligationKey(key: unknown): { ruleKey: string; anchor: string } | null {
  if (typeof key !== "string") return null;
  const match = KEY.exec(key);
  return match ? { ruleKey: `${match[1].toLowerCase()}@${match[2]}`, anchor: match[3].toLowerCase() } : null;
}

/** The date a fact can anchor a rule with: a `date` fact's `date_on`. */
export const anchorDateOf = (fact: Pick<ProfileFact, "kind" | "data">): string | null =>
  fact.kind === "date" && isIsoDate(fact.data.date_on) ? fact.data.date_on : null;

/** The facts a lawyer may pick as an anchor: confirmed, not stale, with a date. */
export const anchorChoices = (facts: readonly ProfileFact[]): ProfileFact[] =>
  facts.filter((fact) => countsForRadar(fact) && anchorDateOf(fact) !== null);

/** `iso` after the operations, in order; null when one leaves the supported years or is business days. */
export function applyOps(iso: string, ops: readonly RuleOp[]): string | null {
  let date: string | null = iso;
  for (const op of ops) {
    if (date === null) return null;
    if ("adjust" in op) date = op.adjust === "month_start" ? startOfMonth(date) : op.adjust === "month_end" ? endOfMonth(date) : null;
    else if (op.unit === "business_days") return null;
    else date = addCalendar(date, op.unit, op.amount);
  }
  return date;
}

function itemFor({ rule, anchorFactId, mode }: ActiveRule, fact: ProfileFact | undefined): DerivedObligation {
  const make = (fields: Partial<DerivedObligation>): DerivedObligation => ({
    key: obligationKey(rule, anchorFactId),
    rule,
    factId: anchorFactId,
    dueOn: null,
    startsOn: null,
    baseOn: null,
    reviewReason: null,
    source: fact?.source ?? null,
    label: fact?.label ?? rule.code,
    ...fields,
  });
  if (!fact || fact.kind !== "date" || !countsForRadar(fact)) return make({ reviewReason: "anchor_unavailable", source: null });
  const anchor = anchorDateOf(fact);
  if (anchor === null) return make({ reviewReason: "missing_date" });
  if (hasBusinessDays(rule)) return make({ reviewReason: "business_days", baseOn: anchor });

  const base = mode === "first_cycle" && rule.firstCycle ? applyOps(anchor, rule.firstCycle.ops) : anchor;
  if (base === null) return make({ reviewReason: "missing_date", baseOn: anchor });
  const dates = new Map(rule.milestones.map((milestone) => [milestone.kind, applyOps(base, milestone.ops)] as const));
  const dueOn = dates.get(rule.kind === "window" ? "closes" : "due") ?? null;
  const startsOn = rule.kind === "window" ? (dates.get("opens") ?? null) : null;
  if (dueOn === null || (rule.kind === "window" && startsOn === null)) return make({ reviewReason: "missing_date", baseOn: base });
  return make({ dueOn, startsOn, baseOn: base });
}

/** One item per active rule. */
export function deriveObligationItems(active: readonly ActiveRule[], facts: readonly ProfileFact[]): DerivedObligation[] {
  return active.map((entry) => itemFor(entry, facts.find((fact) => fact.id === entry.anchorFactId)));
}
