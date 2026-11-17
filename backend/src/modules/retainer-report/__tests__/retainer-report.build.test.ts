import { describe, expect, it } from "vitest";
import type { MatterRequest, MatterRequestType, ProfileFact, RadarItem } from "@mike/contracts";
import { buildReport, type ReportInput } from "../retainer-report.build";

const TODAY = "2026-11-17"; // period 2026-08-20 .. 2026-11-17, horizon .. 2027-02-15
const types: MatterRequestType[] = [
  { id: "t1", seed_key: "contracts_clients", name: null, sort_order: 10, archived: false },
  { id: "t2", seed_key: null, name: "Poderes", sort_order: 20, archived: false },
];
const request = (id: string, fields: Partial<MatterRequest> = {}): MatterRequest => ({
  id,
  matter_id: "m",
  type_id: "t1",
  title: `Solicitud ${id}`,
  complexity: "routine",
  status: "received",
  assignee_user_id: null,
  assignee_level: null,
  received_on: "2026-10-01",
  closed_on: null,
  version: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  round_count: 0,
  ...fields,
});
const fact = (id: string, fields: Partial<ProfileFact> = {}): ProfileFact =>
  ({
    id,
    matter_id: "m",
    kind: "date",
    label: `Dato ${id}`,
    data: {},
    status: "confirmed",
    stale_reason: null,
    effective_status: "confirmed",
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
    decided_by: null,
    decided_at: "2026-10-05T18:00:00Z",
    events: [],
    ...fields,
  }) as ProfileFact;
const item = (key: string, fields: Partial<RadarItem> = {}): RadarItem =>
  ({
    key,
    fact_id: "f",
    type: "expiry",
    label: `Item ${key}`,
    due_on: "2026-12-01",
    days_left: 14,
    bucket: "next_30",
    state: "open",
    ...fields,
  }) as RadarItem;
const build = (fields: Partial<ReportInput> = {}) =>
  buildReport({ today: TODAY, days: 90, locale: "es-MX", matterName: "Iguala", requests: [], types, facts: [], radarItems: [], ...fields });

describe("requests of the report", () => {
  it("counts by type, complexity, level and state, and lists closed and open", () => {
    const report = build({
      requests: [
        request("a", { status: "closed", closed_on: "2026-10-11", round_count: 3, complexity: "complex", assignee_level: "senior", assignee_user_id: "u" }),
        request("b", { status: "closed", closed_on: "2026-10-04", round_count: 1, type_id: "t2" }),
        request("c", { status: "in_review", received_on: "2026-11-10" }),
        request("d", { status: "cancelled", closed_on: "2026-11-01" }),
      ],
    });
    expect(report.requests.total).toBe(4);
    expect(report.requests.by_type.map((t) => [t.type_id, t.count])).toEqual([["t1", 3], ["t2", 1]]);
    expect(report.requests.by_complexity).toEqual({ routine: 3, standard: 0, complex: 1 });
    expect(report.requests.by_level).toEqual({ apprentice: 0, junior: 0, senior: 1, partner: 0, unassigned: 3 });
    expect(report.requests.by_status).toMatchObject({ closed: 2, in_review: 1, cancelled: 1, received: 0 });
    expect(report.requests.closed.map((r) => [r.id, r.calendar_days, r.rounds])).toEqual([["a", 10, 3], ["b", 3, 1]]);
    expect(report.requests.closed_rounds_total).toBe(4);
    expect(report.requests.closed_average_calendar_days).toBe(6.5);
    expect(report.requests.open.map((r) => [r.id, r.calendar_days])).toEqual([["c", 7]]);
    expect(report.requests.closed[1]).toMatchObject({ type_name: "Poderes", seed_key: null });
  });

  it("has no average when nothing closed", () => {
    expect(build().requests).toMatchObject({ total: 0, closed: [], open: [], closed_average_calendar_days: null, closed_rounds_total: 0 });
  });

  it("includes the first and last day of the period and leaves out what is outside it", () => {
    const report = build({
      requests: [
        request("first", { received_on: "2026-08-20", status: "closed", closed_on: "2026-08-20" }),
        request("lastday", { received_on: "2026-11-17" }),
        request("before", { received_on: "2026-08-01", status: "closed", closed_on: "2026-08-19" }),
        request("old-open", { received_on: "2026-06-01" }),
        request("old-closed-in", { received_on: "2026-06-01", status: "closed", closed_on: "2026-08-20" }),
        request("future", { received_on: "2026-11-18" }),
      ],
    });
    const ids = (list: { id: string }[]) => list.map((r) => r.id).sort();
    expect(ids(report.requests.closed)).toEqual(["first", "old-closed-in"]);
    expect(ids(report.requests.open)).toEqual(["lastday", "old-open"]);
    expect(report.requests.total).toBe(4);
  });

  it("counts a request closed the day it was received as 0 calendar days", () => {
    const report = build({ requests: [request("z", { received_on: "2026-10-01", status: "closed", closed_on: "2026-10-01" })] });
    expect(report.requests.closed[0].calendar_days).toBe(0);
  });

  it("works for a 30 day period", () => {
    const report = build({
      days: 30,
      requests: [request("a", { received_on: "2026-10-01", status: "closed", closed_on: "2026-10-18" }), request("b", { status: "closed", received_on: "2026-10-01", closed_on: "2026-10-19" })],
    });
    expect(report.period).toMatchObject({ days: 30, start: "2026-10-19", end: TODAY });
    expect(report.requests.closed.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("profile and radar of the report", () => {
  it("counts only confirmed, not stale facts", () => {
    const report = build({
      facts: [
        fact("ok"),
        fact("pending", { status: "pending" }),
        fact("rejected", { status: "rejected" }),
        fact("stale", { stale_reason: "text_changed" } as Partial<ProfileFact>),
        fact("old", { kind: "contract", decided_at: "2026-08-19T20:00:00Z" }),
        fact("edge", { decided_at: "2026-08-20T06:00:00Z" }),
        fact("late", { decided_at: "2026-11-18T05:59:00Z" }),
        fact("tomorrow", { decided_at: "2026-11-18T06:00:00Z" }),
        fact("nodate", { decided_at: null }),
      ],
    });
    expect(report.profile.confirmed_total).toBe(6);
    expect(report.profile.by_kind).toMatchObject({ date: 5, contract: 1 });
    // Mexico City days: "edge" is 00:00 of the first day, "late" 23:59 of the last, "tomorrow" is already the next day.
    expect(report.profile.confirmed_in_period.map((f) => [f.id, f.confirmed_on])).toEqual([
      ["late", "2026-11-17"],
      ["ok", "2026-10-05"],
      ["edge", "2026-08-20"],
    ]);
  });

  it("lists open and acknowledged dated items from today to N days ahead", () => {
    const report = build({
      radarItems: [
        item("today", { due_on: "2026-11-17", days_left: 0 }),
        item("last", { due_on: "2027-02-15", days_left: 90, state: "acknowledged" }),
        item("beyond", { due_on: "2027-02-16", days_left: 91 }),
        item("overdue", { due_on: "2026-11-16", days_left: -1 }),
        item("undated", { due_on: null, days_left: null }),
        item("dismissed", { state: "dismissed" }),
        item("done", { state: "done" }),
        item("soon", { due_on: "2026-11-20", days_left: 3 }),
      ],
    });
    expect(report.radar.upcoming.map((i) => i.key)).toEqual(["today", "soon", "last"]);
    expect(report.horizon).toEqual({ start: TODAY, end: "2027-02-15" });
  });
});

describe("what the report never says", () => {
  const report = build({
    requests: [request("a", { status: "closed", closed_on: "2026-10-11", round_count: 2 })],
    facts: [fact("ok")],
    radarItems: [item("k")],
  });
  const keys = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keys)
      : value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)])
        : [];

  it("has no field that mentions hours, time worked or an estimate", () => {
    for (const key of keys(report)) expect(key).not.toMatch(/hour|hora|minute|minuto|time_spent|duration|estimate|estimaci|rate|tarifa/i);
  });

  it("carries the planning-aid text and the scope note in both languages", () => {
    expect(report.disclaimer).toMatch(/^Ayuda de planeación\./);
    expect(report.scope_note).toBe(
      "Solo incluye los datos que el despacho confirmó en los documentos revisados; puede haber vencimientos que no aparezcan.",
    );
    const en = build({ locale: "en-US" });
    expect(en.disclaimer).toMatch(/^Planning aid\./);
    expect(en.scope_note).toBe(
      "It only includes the facts the firm confirmed in the documents it reviewed; some deadlines may not appear.",
    );
  });
});
