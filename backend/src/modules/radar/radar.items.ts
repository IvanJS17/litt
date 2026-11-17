/**
 * The radar of one retainer matter: its facts (client-profile facade), the
 * items derived from the confirmed and not stale ones, and the state each item
 * has from the events people recorded. Computed on every read.
 */

import type { MatterRadar, RadarItem, ProfilePerson } from "@mike/contracts";
import { loadCreatorProfiles } from "../../lib/userLookup";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { queryFailureCause, selectAllByKey } from "../../lib/batchedQuery";
import type { Db } from "../../lib/supabase";
import { loadFacts } from "../client-profile/client-profile.service";
import type { MatterAccess } from "../matters/matters.service";
import { RADAR_TIME_ZONE, todayInMexicoCity } from "./radar.dates";
import { deriveItems } from "./radar.derive";
import { EVENT_COLUMNS, toRadarItem, type EventRow } from "./radar.shared";

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

/** Every item of the matter, closed ones too, dated first. `today` is a Mexico City date. */
export async function loadRadarItems(db: Db, scope: Scope, today: string): Promise<ServiceResult<RadarItem[]>> {
  const facts = await loadFacts(db, scope);
  if (!facts.ok) return facts;
  const derived = deriveItems(facts.data);
  if (derived.length === 0) return ok([]);
  const events = await loadEvents(db, scope.matterId);
  if (!events.ok) return events;
  return ok(derived.map((item) => toRadarItem(item, events.data, today)));
}

async function peopleOf(db: Db, items: readonly RadarItem[]): Promise<ProfilePerson[]> {
  const ids = [...new Set(items.map((item) => item.acted_by).filter((id): id is string => !!id))];
  if (ids.length === 0) return [];
  const profiles = await loadCreatorProfiles(db, ids.map((user_id) => ({ user_id })));
  return ids.map((user_id) => {
    const profile = profiles.get(user_id);
    return { user_id, name: profile?.display_name ?? profile?.email ?? null };
  });
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
    people: await peopleOf(db, items.data),
  });
}
