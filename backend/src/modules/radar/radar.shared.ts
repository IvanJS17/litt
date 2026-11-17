/**
 * Vocabulary and row mapping of the deadline radar (docs/deadline-radar.md).
 * The radar's items are computed (radar.derive.ts); the only thing stored is
 * what a person did with one, as insert-only events.
 */

import type { RadarItem, RadarItemState } from "@mike/contracts";
import { daysBetween } from "./radar.dates";
import { bucketFor, itemKey, type DerivedItem, type RadarItemType } from "./radar.derive";
import { OBLIGATION_ITEM_TYPE, type DerivedObligation } from "./radar.obligations";
import { hasBusinessDays, ruleKey } from "./radar.rules";
import { citationView, milestoneView } from "./radar.rules.view";

export const RADAR_ACTIONS = ["ack", "dismiss", "done"] as const;
export type RadarActionName = (typeof RADAR_ACTIONS)[number];

export const REASON_MAX = 500;
/** Matters whose items the "today" list reads at most; the rest are reported as left out. */
export const MAX_TODAY_MATTERS = 50;

export const NOT_A_RETAINER_CODE = "matter_not_retainer";
export const INVALID_ACTION_CODE = "invalid_radar_action";
export const REASON_REQUIRED_CODE = "radar_reason_required";
export const ITEM_CLOSED_CODE = "radar_item_closed";
export const RULE_UNVERIFIED_CODE = "obligation_rule_unverified";
export const ANCHOR_REQUIRED_CODE = "obligation_anchor_required";
export const ANCHOR_UNAVAILABLE_CODE = "obligation_anchor_unavailable";

/** What the state of an item needs of an event, whichever table it came from. */
export type StateEvent = {
  id: string;
  action: RadarActionName;
  due_on: string | null;
  reason: string | null;
  actor_user_id: string | null;
  created_at: string;
};
export type EventRow = StateEvent & {
  fact_id: string;
  item_type: RadarItemType;
};
export const EVENT_COLUMNS = "id, fact_id, item_type, action, due_on, reason, actor_user_id, created_at";

/** An action on an item of an obligation rule (matter_obligation_item_events). */
export type ObligationEventRow = StateEvent & { item_key: string };
export const OBLIGATION_EVENT_COLUMNS = "id, item_key, action, due_on, reason, actor_user_id, created_at";

/**
 * What the events say about an item. Only events recorded against the item's
 * CURRENT date count: an item whose date changed was recomputed and starts
 * over (a fact is never edited, so this is a safeguard, not a common case).
 * An item moves one way: ack, then dismiss or done.
 */
export function stateOf<E extends StateEvent>(
  item: Pick<DerivedItem, "dueOn">,
  events: readonly E[],
): { state: RadarItemState; last: E | null } {
  const mine = events
    .filter((event) => (event.due_on ?? null) === item.dueOn)
    .sort((a, b) => `${a.created_at}${a.id}`.localeCompare(`${b.created_at}${b.id}`));
  const last = mine.length ? mine[mine.length - 1] : null;
  if (mine.some((event) => event.action === "done")) return { state: "done", last };
  if (mine.some((event) => event.action === "dismiss")) return { state: "dismissed", last };
  if (mine.some((event) => event.action === "ack")) return { state: "acknowledged", last };
  return { state: "open", last: null };
}

export function toRadarItem(item: DerivedItem, events: readonly EventRow[], today: string): RadarItem {
  const own = events.filter((event) => itemKey(event.fact_id, event.item_type) === item.key);
  const { state, last } = stateOf(item, own);
  const bucket = bucketFor(item, today);
  return {
    key: item.key,
    fact_id: item.factId,
    type: item.type,
    label: item.label,
    due_on: item.dueOn,
    days_left: item.dueOn === null ? null : daysBetween(today, item.dueOn),
    bucket,
    review_reason: item.reviewReason,
    base_on: item.baseOn,
    notice_days: item.noticeDays,
    rule_text: item.ruleText,
    state,
    acted_by: last?.actor_user_id ?? null,
    acted_at: last?.created_at ?? null,
    reason: state === "dismissed" ? (own.find((event) => event.action === "dismiss")?.reason ?? null) : null,
    source: item.source,
    obligation: null,
  };
}

export function toObligationRadarItem(item: DerivedObligation, events: readonly ObligationEventRow[], today: string): RadarItem {
  const own = events.filter((event) => event.item_key === item.key);
  const { state, last } = stateOf(item, own);
  const rule = item.rule;
  return {
    key: item.key,
    fact_id: item.factId,
    type: OBLIGATION_ITEM_TYPE,
    label: item.label,
    due_on: item.dueOn,
    days_left: item.dueOn === null ? null : daysBetween(today, item.dueOn),
    bucket: bucketFor(item, today),
    review_reason: item.reviewReason,
    base_on: item.baseOn,
    notice_days: null,
    rule_text: null,
    state,
    acted_by: last?.actor_user_id ?? null,
    acted_at: last?.created_at ?? null,
    reason: state === "dismissed" ? (own.find((event) => event.action === "dismiss")?.reason ?? null) : null,
    source: item.source,
    obligation: {
      rule_key: ruleKey(rule),
      name_key: rule.nameKey,
      kind: rule.kind,
      starts_on: item.startsOn,
      milestones: rule.milestones.map(milestoneView),
      requires_business_days: hasBusinessDays(rule),
      citations: rule.citations.map(citationView),
      notes: rule.notes ?? null,
    },
  };
}

/** Alive items (not dismissed or done). */
export const isOpen = (item: Pick<RadarItem, "state">) => item.state === "open" || item.state === "acknowledged";
