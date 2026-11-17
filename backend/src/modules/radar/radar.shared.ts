/**
 * Vocabulary and row mapping of the deadline radar (docs/deadline-radar.md).
 * The radar's items are computed (radar.derive.ts); the only thing stored is
 * what a person did with one, as insert-only events.
 */

import type { RadarItem, RadarItemState } from "@mike/contracts";
import { daysBetween } from "./radar.dates";
import { bucketFor, itemKey, type DerivedItem, type RadarItemType } from "./radar.derive";

export const RADAR_ACTIONS = ["ack", "dismiss", "done"] as const;
export type RadarActionName = (typeof RADAR_ACTIONS)[number];

export const REASON_MAX = 500;
/** Matters whose items the "today" list reads at most; the rest are reported as left out. */
export const MAX_TODAY_MATTERS = 50;

export const NOT_A_RETAINER_CODE = "matter_not_retainer";
export const INVALID_ACTION_CODE = "invalid_radar_action";
export const REASON_REQUIRED_CODE = "radar_reason_required";
export const ITEM_CLOSED_CODE = "radar_item_closed";

export type EventRow = {
  id: string;
  fact_id: string;
  item_type: RadarItemType;
  action: RadarActionName;
  due_on: string | null;
  reason: string | null;
  actor_user_id: string | null;
  created_at: string;
};
export const EVENT_COLUMNS = "id, fact_id, item_type, action, due_on, reason, actor_user_id, created_at";

/**
 * What the events say about an item. Only events recorded against the item's
 * CURRENT date count: an item whose date changed was recomputed and starts
 * over (a fact is never edited, so this is a safeguard, not a common case).
 * An item moves one way: ack, then dismiss or done.
 */
export function stateOf(
  item: Pick<DerivedItem, "dueOn">,
  events: readonly EventRow[],
): { state: RadarItemState; last: EventRow | null } {
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
  };
}

/** Alive items (not dismissed or done). */
export const isOpen = (item: Pick<RadarItem, "state">) => item.state === "open" || item.state === "acknowledged";
