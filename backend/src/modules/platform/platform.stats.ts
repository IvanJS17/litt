// Beta statistics for platform administrators (LiTT). Counts only: every
// number comes from tables that already exist, and no read touches content
// (no chat text, prompts, document names or keys). Each view is recorded in
// the insert-only audit; the HTTP layer has already checked the caller.
//
// Rules from the legal opinion (Aviso §4, finalidad 11):
//  - aggregate totals may include everyone;
//  - the per-firm and per-person views list only people who accepted the
//    current LEGAL_VERSION;
//  - an account being deleted appears as a deleted user, with no profile;
//  - only the fields below are returned (proportionality), and there is no
//    export.
// Usage is counted over the last 30 days (7 and 30 for the overview), and
// "last activity" is the latest of those events, so it is empty for someone
// idle for longer.

import { insertAuditEvent } from "../../lib/audit";
import {
  selectAllByKey,
  selectInBatches,
  queryFailureCause,
} from "../../lib/batchedQuery";
import { internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { LEGAL_VERSION } from "../user/user.profile.storage";

export const STATS_FEATURES = [
  "chats",
  "documents",
  "compared",
  "converted",
  "scans",
  "split",
  "tabular",
  "training",
] as const;
export type StatsFeature = (typeof STATS_FEATURES)[number];
export type UsageCounts = Record<StatsFeature, number>;

export type PlatformStats = {
  generated_at: string;
  legal_version: string;
  totals: {
    users: number;
    deleted_users: number;
    organizations: number;
    awaiting_acceptance: number;
  };
  breakdowns: {
    scope: StatsBucket[];
    title: StatsBucket[];
    jurisdiction: StatsBucket[];
    practice_area: StatsBucket[];
  };
  usage: { last_7_days: UsageCounts; last_30_days: UsageCounts };
  organizations: { name: string; members: number; usage: UsageCounts }[];
  people: StatsPerson[];
};
export type StatsBucket = { key: string | null; count: number };
export type StatsPerson = {
  deleted: boolean;
  name: string | null;
  email: string | null;
  organizations: string[];
  scope: string | null;
  title: string | null;
  jurisdiction: string | null;
  practice_areas: string[];
  usage: UsageCounts;
  last_activity: string | null;
};

type Profile = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  practice_setting: string | null;
  professional_title: string | null;
  jurisdiction: string | null;
  practice_areas: string[] | null;
  terms_accepted_version: string | null;
  account_deletion_requested_at: string | null;
};
type UsageEvent = { user_id: string; feature: StatsFeature; at: string };

const DAY = 24 * 60 * 60 * 1000;
const emptyUsage = (): UsageCounts =>
  Object.fromEntries(STATS_FEATURES.map((f) => [f, 0])) as UsageCounts;

function bucketize(values: (string | null)[]): StatsBucket[] {
  const counts = new Map<string | null, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key ?? "").localeCompare(String(b.key ?? "")));
}

/** One row per feature use in the window, from existing tables, ids and dates only. */
async function usageEvents(db: Db, since: string): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  const read = <T extends Record<string, unknown>>(
    label: string,
    table: string,
    columns: string,
    key: string,
    filter: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ) =>
    selectAllByKey<T>(label, () => filter(db.from(table).select(columns)).gte("created_at", since), key);

  for (const r of await read<{ user_id: string | null; created_at: string }>(
    "stats.chats", "chats", "id,user_id,created_at", "id", (q) => q))
    if (r.user_id) events.push({ user_id: r.user_id, feature: "chats", at: r.created_at });
  for (const r of await read<{ user_id: string | null; created_at: string }>(
    "stats.tabular", "tabular_reviews", "id,user_id,created_at", "id", (q) => q))
    if (r.user_id) events.push({ user_id: r.user_id, feature: "tabular", at: r.created_at });
  for (const r of await read<{ trainee_user_id: string; created_at: string }>(
    "stats.training", "training_gym_attempts", "id,trainee_user_id,created_at", "id", (q) => q))
    events.push({ user_id: r.trainee_user_id, feature: "training", at: r.created_at });
  for (const r of await read<{ requested_by: string | null; created_at: string }>(
    "stats.scans", "document_version_ocr", "version_id,requested_by,created_at", "version_id",
    (q) => q.eq("status", "ready")))
    if (r.requested_by) events.push({ user_id: r.requested_by, feature: "scans", at: r.created_at });

  // Documents: a version row has no owner, so the owner comes from its document.
  const versions = await read<{ document_id: string; source: string; created_at: string }>(
    "stats.versions", "document_versions", "id,document_id,source,created_at", "id",
    (q) => q.in("source", ["upload", "user_upload", "compared", "converted", "split"]));
  const owners = new Map<string, { user_id: string | null; library_kind: string }>();
  for (const d of await selectInBatches<{
    id: string; user_id: string | null; library_kind: string;
  }>("stats.documents", versions.map((v) => v.document_id), (ids) =>
    db.from("documents").select("id,user_id,library_kind").in("id", ids)))
    owners.set(d.id, d);
  const featureOf: Record<string, StatsFeature> = {
    upload: "documents", user_upload: "documents",
    compared: "compared", converted: "converted", split: "split",
  };
  for (const v of versions) {
    const owner = owners.get(v.document_id);
    if (!owner?.user_id) continue;
    const feature = featureOf[v.source];
    if (feature === "documents" && owner.library_kind !== "file") continue;
    events.push({ user_id: owner.user_id, feature, at: v.created_at });
  }
  return events;
}

export async function buildPlatformStats(db: Db, now = new Date()): Promise<PlatformStats> {
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();

  const profiles = await selectAllByKey<Profile>("stats.profiles", () =>
    db.from("user_profiles").select(
      "user_id,email,display_name,practice_setting,professional_title,jurisdiction,practice_areas,terms_accepted_version,account_deletion_requested_at",
    ), "user_id");
  const orgs = await selectAllByKey<{ id: string; name: string }>("stats.orgs", () =>
    db.from("organizations").select("id,name").eq("kind", "team"));
  const members = await selectAllByKey<{ id: string; org_id: string; user_id: string }>(
    "stats.members", () => db.from("org_members").select("id,org_id,user_id"));
  const events = await usageEvents(db, since30);

  const live = profiles.filter((p) => !p.account_deletion_requested_at);
  const deleted = profiles.filter((p) => p.account_deletion_requested_at);
  const accepted = (p: Profile) => p.terms_accepted_version === LEGAL_VERSION;

  const total7 = emptyUsage();
  const total30 = emptyUsage();
  const perUser = new Map<string, { usage: UsageCounts; last: string | null }>();
  for (const e of events) {
    total30[e.feature]++;
    if (e.at >= since7) total7[e.feature]++;
    const u = perUser.get(e.user_id) ?? { usage: emptyUsage(), last: null };
    u.usage[e.feature]++;
    if (!u.last || e.at > u.last) u.last = e.at;
    perUser.set(e.user_id, u);
  }

  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
  const memberOrgs = new Map<string, string[]>();
  const orgMembers = new Map<string, string[]>();
  const acceptedIds = new Set(live.filter(accepted).map((p) => p.user_id));
  for (const m of members) {
    if (!orgNames.has(m.org_id) || !acceptedIds.has(m.user_id)) continue;
    memberOrgs.set(m.user_id, [...(memberOrgs.get(m.user_id) ?? []), orgNames.get(m.org_id)!]);
    orgMembers.set(m.org_id, [...(orgMembers.get(m.org_id) ?? []), m.user_id]);
  }

  const sum = (ids: string[]): UsageCounts => {
    const total = emptyUsage();
    for (const id of ids)
      for (const f of STATS_FEATURES) total[f] += perUser.get(id)?.usage[f] ?? 0;
    return total;
  };

  const people: StatsPerson[] = [
    ...live.filter(accepted).map((p): StatsPerson => ({
      deleted: false,
      name: p.display_name,
      email: p.email,
      organizations: (memberOrgs.get(p.user_id) ?? []).sort(),
      scope: p.practice_setting,
      title: p.professional_title,
      jurisdiction: p.jurisdiction,
      practice_areas: p.practice_areas ?? [],
      usage: perUser.get(p.user_id)?.usage ?? emptyUsage(),
      last_activity: perUser.get(p.user_id)?.last ?? null,
    })),
    // No profile at all: only that the account is gone, and what it did.
    ...deleted.map((p): StatsPerson => ({
      deleted: true, name: null, email: null, organizations: [], scope: null, title: null,
      jurisdiction: null, practice_areas: [],
      usage: perUser.get(p.user_id)?.usage ?? emptyUsage(),
      last_activity: perUser.get(p.user_id)?.last ?? null,
    })),
  ].sort((a, b) => Number(a.deleted) - Number(b.deleted)
    || (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));

  return {
    generated_at: now.toISOString(),
    legal_version: LEGAL_VERSION,
    totals: {
      users: live.length,
      deleted_users: deleted.length,
      organizations: orgs.length,
      awaiting_acceptance: live.filter((p) => !accepted(p)).length,
    },
    breakdowns: {
      scope: bucketize(live.map((p) => p.practice_setting)),
      title: bucketize(live.map((p) => p.professional_title)),
      jurisdiction: bucketize(live.map((p) => p.jurisdiction?.trim() || null)),
      practice_area: bucketize(live.flatMap((p) => p.practice_areas ?? [])),
    },
    usage: { last_7_days: total7, last_30_days: total30 },
    organizations: orgs
      .filter((o) => orgMembers.has(o.id))
      .map((o) => ({
        name: o.name,
        members: orgMembers.get(o.id)!.length,
        usage: sum(orgMembers.get(o.id)!),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    people,
  };
}

/**
 * The statistics, for a platform administrator. The view is audited BEFORE the
 * data is read, and a failed audit write fails the request: no access without
 * its record.
 */
export async function viewPlatformStats(
  db: Db,
  actor: { userId: string; email: string | null },
): Promise<ServiceResult<PlatformStats>> {
  try {
    await insertAuditEvent(db, {
      userId: actor.userId,
      userEmail: actor.email,
      action: "platform.stats_viewed",
      surface: "platform",
    });
    return ok(await buildPlatformStats(db));
  } catch (error) {
    return internalFailure(queryFailureCause(error));
  }
}
