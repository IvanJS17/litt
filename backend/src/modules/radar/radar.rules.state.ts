/**
 * Which obligation rules a matter has turned on. Stored as insert-only events
 * (matter_obligation_rule_events); a rule is on when its latest event for the
 * matter is `activate`. A rule is named by code AND version, so a new version
 * of a rule starts off. Read in full, paged past PostgREST's max_rows.
 */

import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { queryFailureCause, selectAllByKey } from "../../lib/batchedQuery";
import type { Db } from "../../lib/supabase";

export type RuleState = {
  active: boolean;
  /** The anchor an active rule counts from; null when it is off. */
  anchor: { factId: string; mode: "direct" | "first_cycle" } | null;
  by: string | null;
  at: string | null;
};
export const OFF: RuleState = { active: false, anchor: null, by: null, at: null };

type RuleEventRow = {
  id: string;
  rule_code: string;
  rule_version: number;
  action: "activate" | "deactivate";
  anchor_fact_id: string | null;
  anchor_mode: "direct" | "first_cycle" | null;
  actor_user_id: string | null;
  created_at: string;
};
const RULE_EVENT_COLUMNS = "id, rule_code, rule_version, action, anchor_fact_id, anchor_mode, actor_user_id, created_at";

/** The state of every rule the matter has an event for, by `<code>@<version>`. */
export async function loadRuleStates(db: Db, matterId: string): Promise<ServiceResult<Map<string, RuleState>>> {
  try {
    const rows = await selectAllByKey<RuleEventRow>("obligation rule events", () =>
      db.from("matter_obligation_rule_events").select(RULE_EVENT_COLUMNS).eq("matter_id", matterId),
    );
    const latest = new Map<string, RuleEventRow>();
    for (const row of rows) {
      const key = `${row.rule_code}@${row.rule_version}`;
      const seen = latest.get(key);
      if (!seen || `${row.created_at}${row.id}`.localeCompare(`${seen.created_at}${seen.id}`) > 0) latest.set(key, row);
    }
    return ok(
      new Map(
        [...latest].map(([key, row]) => [
          key,
          {
            active: row.action === "activate",
            anchor: row.action === "activate" && row.anchor_fact_id ? { factId: row.anchor_fact_id, mode: row.anchor_mode ?? "direct" } : null,
            by: row.actor_user_id,
            at: row.created_at,
          } satisfies RuleState,
        ]),
      ),
    );
  } catch (error) {
    return internalFailure(queryFailureCause(error));
  }
}

/** Records a decision; the database refuses an event that does not follow the last one (23514). */
export async function recordRuleEvent(
  db: Db,
  event: {
    matterId: string;
    ruleCode: string;
    ruleVersion: number;
    action: "activate" | "deactivate";
    anchor?: { factId: string; mode: "direct" | "first_cycle" };
    userId: string;
  },
): Promise<ServiceResult<{ raced: boolean }>> {
  const { error } = await db.from("matter_obligation_rule_events").insert({
    matter_id: event.matterId,
    rule_code: event.ruleCode,
    rule_version: event.ruleVersion,
    action: event.action,
    anchor_fact_id: event.anchor?.factId ?? null,
    anchor_mode: event.anchor?.mode ?? null,
    actor_user_id: event.userId,
  });
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "23514") return ok({ raced: true });
  if (error) return internalFailure(error);
  return ok({ raced: false });
}
