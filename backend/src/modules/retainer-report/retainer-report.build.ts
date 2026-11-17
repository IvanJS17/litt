/**
 * Pure: the report of a retainer matter for a period, from what the other
 * modules already read (requests, confirmed profile facts, radar items). No
 * database, no clock (today is an argument), no model. Only confirmed data
 * enters: a radar item exists only for a confirmed, not stale fact, and the
 * profile numbers count the same facts.
 */

import type {
  MatterRequest,
  MatterRequestComplexity,
  MatterRequestLevel,
  MatterRequestStatus,
  MatterRequestType,
  ProfileFact,
  ProfileFactKind,
  RadarItem,
  RetainerReport,
  RetainerReportDays,
  RetainerReportFact,
  RetainerReportLocale,
  RetainerReportRadarItem,
  RetainerReportRequest,
  RetainerReportTypeCount,
} from "@mike/contracts";
import { labelsFor } from "./retainer-report.labels";
import {
  daysBetween,
  inRange,
  MAX_LISTED,
  periodFor,
  REPORT_TIME_ZONE,
  todayInMexicoCity,
} from "./retainer-report.shared";

export type ReportInput = {
  /** Today in America/Mexico_City (YYYY-MM-DD). */
  today: string;
  days: RetainerReportDays;
  locale: RetainerReportLocale;
  matterName: string | null;
  requests: readonly MatterRequest[];
  types: readonly MatterRequestType[];
  facts: readonly ProfileFact[];
  radarItems: readonly RadarItem[];
};

const COMPLEXITIES: readonly MatterRequestComplexity[] = ["routine", "standard", "complex"];
const LEVELS: readonly MatterRequestLevel[] = ["apprentice", "junior", "senior", "partner"];
const STATUSES: readonly MatterRequestStatus[] = [
  "received",
  "in_review",
  "with_client",
  "with_counterparty",
  "closed",
  "cancelled",
];
const KINDS: readonly ProfileFactKind[] = ["contract", "date", "power_of_attorney", "obligation", "other"];

function zero<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

/** A confirmed fact whose cited text is unchanged: the only kind the report counts. */
const isConfirmed = (fact: Pick<ProfileFact, "status" | "stale_reason">) =>
  fact.status === "confirmed" && fact.stale_reason === null;

export function buildReport(input: ReportInput): RetainerReport {
  const period = periodFor(input.today, input.days);
  const labels = labelsFor(input.locale);
  const typeById = new Map(input.types.map((type) => [type.id, type]));

  // A request belongs to the period when it was received by its last day and
  // had not been closed or cancelled before its first.
  const inPeriod = input.requests.filter(
    (request) =>
      request.received_on <= period.end && (request.closed_on === null || request.closed_on >= period.start),
  );

  const view = (request: MatterRequest): RetainerReportRequest => {
    const type = typeById.get(request.type_id);
    return {
      id: request.id,
      title: request.title,
      type_id: request.type_id,
      seed_key: type?.seed_key ?? null,
      type_name: type?.name ?? null,
      complexity: request.complexity,
      level: request.assignee_level,
      status: request.status,
      received_on: request.received_on,
      closed_on: request.closed_on,
      calendar_days: daysBetween(request.received_on, request.closed_on ?? period.end),
      rounds: request.round_count,
    };
  };

  const byComplexity = zero(COMPLEXITIES);
  const byLevel = zero<MatterRequestLevel | "unassigned">([...LEVELS, "unassigned"]);
  const byStatus = zero(STATUSES);
  const typeCounts = new Map<string, number>();
  for (const request of inPeriod) {
    byComplexity[request.complexity] += 1;
    byLevel[request.assignee_level ?? "unassigned"] += 1;
    byStatus[request.status] += 1;
    typeCounts.set(request.type_id, (typeCounts.get(request.type_id) ?? 0) + 1);
  }
  const byType: RetainerReportTypeCount[] = [...typeCounts]
    .map(([type_id, count]) => {
      const type = typeById.get(type_id);
      return { type_id, seed_key: type?.seed_key ?? null, name: type?.name ?? null, count };
    })
    .sort(
      (a, b) =>
        (typeById.get(a.type_id)?.sort_order ?? 0) - (typeById.get(b.type_id)?.sort_order ?? 0) ||
        a.type_id.localeCompare(b.type_id),
    );

  const closed = inPeriod
    .filter((request) => request.status === "closed" && request.closed_on !== null && inRange(request.closed_on, period.start, period.end))
    .map(view)
    .sort((a, b) => (b.closed_on ?? "").localeCompare(a.closed_on ?? "") || a.id.localeCompare(b.id));
  const open = inPeriod
    .filter((request) => request.closed_on === null)
    .map(view)
    .sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id));
  const closedDays = closed.reduce((sum, request) => sum + request.calendar_days, 0);

  const confirmed = input.facts.filter(isConfirmed);
  const byKind = zero(KINDS);
  for (const fact of confirmed) byKind[fact.kind] += 1;
  const changed: RetainerReportFact[] = confirmed
    .flatMap((fact) =>
      fact.decided_at
        ? [{ id: fact.id, kind: fact.kind, label: fact.label, confirmed_on: todayInMexicoCity(new Date(fact.decided_at)) }]
        : [],
    )
    .filter((fact) => inRange(fact.confirmed_on, period.start, period.end))
    .sort((a, b) => b.confirmed_on.localeCompare(a.confirmed_on) || a.id.localeCompare(b.id))
    .slice(0, MAX_LISTED);

  const upcoming: RetainerReportRadarItem[] = input.radarItems
    .flatMap((item) =>
      item.due_on !== null &&
      item.days_left !== null &&
      (item.state === "open" || item.state === "acknowledged") &&
      inRange(item.due_on, period.horizonStart, period.horizonEnd)
        ? [{ key: item.key, type: item.type, label: item.label, due_on: item.due_on, days_left: item.days_left, state: item.state }]
        : [],
    )
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.key.localeCompare(b.key))
    .slice(0, MAX_LISTED);

  return {
    locale: input.locale,
    matter_name: input.matterName,
    period: { days: input.days, start: period.start, end: period.end, time_zone: REPORT_TIME_ZONE },
    horizon: { start: period.horizonStart, end: period.horizonEnd },
    requests: {
      total: inPeriod.length,
      by_type: byType,
      by_complexity: byComplexity,
      by_level: byLevel,
      by_status: byStatus,
      closed,
      open,
      closed_rounds_total: closed.reduce((sum, request) => sum + request.rounds, 0),
      closed_average_calendar_days: closed.length ? Math.round((closedDays / closed.length) * 10) / 10 : null,
    },
    profile: { confirmed_total: confirmed.length, by_kind: byKind, confirmed_in_period: changed },
    radar: { upcoming },
    disclaimer: labels.disclaimer,
    scope_note: labels.scopeNote,
  };
}
