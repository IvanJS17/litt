/**
 * Pure: the radar items of a matter, derived from its client-profile facts.
 * Only a fact a lawyer CONFIRMED whose cited text has NOT changed counts; a
 * pending, rejected or stale fact yields nothing, so an item vanishes the
 * moment its fact stops being trustworthy and comes back only if the fact
 * does. Nothing is stored: this runs on every read.
 *
 * What each fact yields (dates are computed in calendar days, see radar.dates):
 *
 *   date / expiry          expiry item at `date_on`; with a calendar notice
 *                          period also a notice item at `date_on - notice_days`
 *   date / renewal_notice  notice item at `date_on - notice_days`, or at
 *                          `date_on` itself when no period is stored
 *   power_of_attorney      power_expiry item at `expires_on`
 *   any other fact         nothing (an `effective` date is not a deadline)
 *
 * A notice period in BUSINESS days is never computed: the item has no date and
 * is left "to review". A date fact that names a period or a rule but no date
 * has no date to count from: also "to review" with no date.
 */

import type { ProfileFact, ProfileFactSource } from "@mike/contracts";
import { addDays, bucketOf, type RadarBucket } from "./radar.dates";

export type RadarItemType = "expiry" | "notice" | "power_expiry";
export type RadarReviewReason = "business_days" | "missing_date" | "anchor_unavailable";

export type DerivedItem = {
  key: string;
  factId: string;
  type: RadarItemType;
  label: string;
  dueOn: string | null;
  baseOn: string | null;
  noticeDays: number | null;
  ruleText: string | null;
  reviewReason: RadarReviewReason | null;
  source: ProfileFactSource;
};

export const ITEM_TYPES: readonly RadarItemType[] = ["expiry", "notice", "power_expiry"];

export const itemKey = (factId: string, type: RadarItemType) => `${factId}:${type}`;

/** `<fact id>:<type>` back into its parts, or null. */
export function parseItemKey(key: unknown): { factId: string; type: RadarItemType } | null {
  if (typeof key !== "string") return null;
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-z_]+)$/i.exec(key);
  if (!match || !(ITEM_TYPES as readonly string[]).includes(match[2])) return null;
  return { factId: match[1].toLowerCase(), type: match[2] as RadarItemType };
}

/** A fact the radar may use: confirmed by a lawyer and its cited text unchanged. */
export const countsForRadar = (fact: Pick<ProfileFact, "status" | "stale_reason">): boolean =>
  fact.status === "confirmed" && fact.stale_reason === null;

function itemsOf(fact: ProfileFact): DerivedItem[] {
  const base = { factId: fact.id, label: fact.label, source: fact.source };
  const make = (
    type: RadarItemType,
    fields: { dueOn: string | null; baseOn?: string | null; noticeDays?: number | null; reviewReason?: RadarReviewReason | null },
  ): DerivedItem => ({
    ...base,
    key: itemKey(fact.id, type),
    type,
    dueOn: fields.dueOn,
    baseOn: fields.baseOn ?? null,
    noticeDays: fields.noticeDays ?? null,
    ruleText: fact.data.rule_text ?? null,
    reviewReason: fields.reviewReason ?? null,
  });
  const data = fact.data;

  if (fact.kind === "power_of_attorney") {
    return data.expires_on ? [make("power_expiry", { dueOn: data.expires_on })] : [];
  }
  if (fact.kind !== "date" || (data.date_kind !== "expiry" && data.date_kind !== "renewal_notice")) return [];

  const days = data.notice_days ?? null;
  const business = data.notice_day_type === "business";
  const out: DerivedItem[] = [];
  const dateOn = data.date_on ?? null;

  if (data.date_kind === "expiry" && dateOn) out.push(make("expiry", { dueOn: dateOn }));

  const hasNotice = days !== null || data.date_kind === "renewal_notice";
  if (!hasNotice) {
    // An expiry with neither a date nor a period: only its rule, if any.
    if (!dateOn && data.rule_text) out.push(make("expiry", { dueOn: null, reviewReason: "missing_date" }));
    return out;
  }
  if (days !== null && business) {
    out.push(make("notice", { dueOn: null, baseOn: dateOn, noticeDays: days, reviewReason: "business_days" }));
    return out;
  }
  if (!dateOn) {
    // Something to track (a period or a rule) but nothing to count from.
    if (days !== null || data.rule_text)
      out.push(make("notice", { dueOn: null, noticeDays: days, reviewReason: "missing_date" }));
    return out;
  }
  const noticeOn = days === null ? dateOn : addDays(dateOn, -days);
  out.push(
    noticeOn
      ? make("notice", { dueOn: noticeOn, baseOn: days === null ? null : dateOn, noticeDays: days })
      : make("notice", { dueOn: null, baseOn: dateOn, noticeDays: days, reviewReason: "missing_date" }),
  );
  return out;
}

/** The items of the facts that count, dated ones first by date, then those to review. */
export function deriveItems(facts: readonly ProfileFact[]): DerivedItem[] {
  const items = facts.filter(countsForRadar).flatMap(itemsOf);
  return items.sort((a, b) => {
    if ((a.dueOn === null) !== (b.dueOn === null)) return a.dueOn === null ? 1 : -1;
    return (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.key.localeCompare(b.key);
  });
}

export const bucketFor = (item: Pick<DerivedItem, "dueOn">, today: string): RadarBucket =>
  bucketOf(item.dueOn, today);
