/**
 * The radar of one retainer matter: its facts (client-profile facade), the
 * items derived from the confirmed and not stale ones, and the state each item
 * has from the events people recorded. Computed on every read.
 */

import type { MatterRadar, ProfileFact, RadarItem } from "@mike/contracts";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { queryFailureCause, selectAllByKey } from "../../lib/batchedQuery";
import type { Db } from "../../lib/supabase";
import { loadFacts } from "../client-profile/client-profile.service";
import type { MatterAccess } from "../matters/matters.service";
import { RADAR_TIME_ZONE, todayInMexicoCity } from "./radar.dates";
import { deriveItems } from "./radar.derive";
import { deriveObligationItems } from "./radar.obligations";
import { namePeople } from "./radar.people";
import { OBLIGATION_RULES } from "./radar.rules.catalog";
import type { ObligationRuleDef } from "./radar.rules";
import { loadActiveRules } from "./radar.rules.manage";
import {
  EVENT_COLUMNS,
  OBLIGATION_EVENT_COLUMNS,
  toObligationRadarItem,
  toRadarItem,
  type EventRow,
  type ObligationEventRow,
} from "./radar.shared";

type Scope = Pick<MatterAccess, "matterId" | "projectId">;

/**
 * Every event of the matter, paged by id: PostgREST caps a response at
 * max_rows (1000), so one unpaged read returns a prefix, and the state machine
 * needs the newest actions as much as the oldest. Order does not matter here
 * (stateOf sorts by created_at, id).
 */
async function loadEvents(db: Db, matterId: string): Promise<ServiceResult<EventRow[]>> {
  try {
    const rows = await selectAllByKey<EventRow>("radar events", () =>
      db.from("matter_radar_item_events").select(EVENT_COLUMNS).eq("matter_id", matterId),
    );
    return ok(rows);
  } catch (error) {
    return internalFailure(queryFailureCause(error));
  }
}

async function loadObligationEvents(db: Db, matterId: string): Promise<ServiceResult<ObligationEventRow[]>> {
  try {
    const rows = await selectAllByKey<ObligationEventRow>("obligation item events", () =>
      db.from("matter_obligation_item_events").select(OBLIGATION_EVENT_COLUMNS).eq("matter_id", matterId),
    );
    return ok(rows);
  } catch (error) {
    return internalFailure(queryFailureCause(error));
  }
}

/** The items of the matter's active obligation rules, with the state each has from the events. */
async function loadObligationItems(
  db: Db,
  matterId: string,
  facts: readonly ProfileFact[],
  today: string,
  catalog: readonly ObligationRuleDef[],
): Promise<ServiceResult<RadarItem[]>> {
  const active = await loadActiveRules(db, matterId, catalog);
  if (!active.ok) return active;
  const derived = deriveObligationItems(active.data, facts);
  if (derived.length === 0) return ok([]);
  const events = await loadObligationEvents(db, matterId);
  if (!events.ok) return events;
  return ok(derived.map((item) => toObligationRadarItem(item, events.data, today)));
}

const byDate = (a: RadarItem, b: RadarItem) => {
  if ((a.due_on === null) !== (b.due_on === null)) return a.due_on === null ? 1 : -1;
  return (a.due_on ?? "").localeCompare(b.due_on ?? "") || a.key.localeCompare(b.key);
};

/** Every item of the matter, closed ones too, dated first. `today` is a Mexico City date. */
export async function loadRadarItems(
  db: Db,
  scope: Scope,
  today: string,
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<RadarItem[]>> {
  const facts = await loadFacts(db, scope);
  if (!facts.ok) return facts;
  const obligations = await loadObligationItems(db, scope.matterId, facts.data, today, catalog);
  if (!obligations.ok) return obligations;
  const derived = deriveItems(facts.data);
  if (derived.length === 0) return ok(obligations.data.sort(byDate));
  const events = await loadEvents(db, scope.matterId);
  if (!events.ok) return events;
  return ok([...derived.map((item) => toRadarItem(item, events.data, today)), ...obligations.data].sort(byDate));
}

export async function loadMatterRadar(db: Db, access: MatterAccess, now: Date): Promise<ServiceResult<MatterRadar>> {
  const today = todayInMexicoCity(now);
  const base = { today, time_zone: RADAR_TIME_ZONE };
  if (!access.isRetainer) return ok({ retainer: false, can_write: false, ...base, items: [], people: [] });
  const items = await loadRadarItems(db, access, today);
  if (!items.ok) return items;
  return ok({
    retainer: true,
    can_write: access.canWrite,
    ...base,
    items: items.data,
    people: await namePeople(db, items.data.map((item) => item.acted_by)),
  });
}
