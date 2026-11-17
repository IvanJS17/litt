import type { ProfileFact, ProfileFactData, ProfileFactKind } from "@mike/contracts";
import { describe, expect, it } from "vitest";
import { countsForRadar, deriveItems, itemKey, parseItemKey } from "../radar.derive";
import { toRadarItem, type EventRow } from "../radar.shared";

const FACT = "00000000-0000-4000-8000-000000000001";
const fact = (data: ProfileFactData, extra: Partial<ProfileFact> = {}, kind: ProfileFactKind = "date"): ProfileFact => ({
  id: FACT,
  matter_id: "m",
  kind,
  label: "Arrendamiento",
  data,
  status: "confirmed",
  stale_reason: null,
  effective_status: "confirmed",
  source: {
    document_id: "d",
    version_id: "v",
    version_number: 1,
    filename: "contrato.docx",
    start_char: 0,
    end_char: 5,
    quote: "cita",
    text_sha256: "a".repeat(64),
  },
  created_by: null,
  created_at: "2026-11-01T00:00:00Z",
  decided_by: null,
  decided_at: null,
  events: [],
  ...extra,
});
const one = (data: ProfileFactData, extra: Partial<ProfileFact> = {}, kind: ProfileFactKind = "date") =>
  deriveItems([fact(data, extra, kind)]);
const due = (items: ReturnType<typeof deriveItems>) => items.map((item) => [item.type, item.dueOn, item.reviewReason]);

describe("which facts count", () => {
  const data = { date_kind: "expiry", date_on: "2027-01-31" } as const;
  it("uses only confirmed facts whose text has not changed", () => {
    expect(one(data)).toHaveLength(1);
    for (const status of ["pending", "rejected"] as const)
      expect(one(data, { status, effective_status: status }), status).toEqual([]);
    for (const stale_reason of ["version_missing", "text_unavailable", "text_changed"] as const)
      expect(one(data, { stale_reason, effective_status: "stale" }), stale_reason).toEqual([]);
    expect(countsForRadar({ status: "confirmed", stale_reason: null })).toBe(true);
    expect(countsForRadar({ status: "confirmed", stale_reason: "text_changed" })).toBe(false);
  });

  it("derives nothing from contracts, obligations, other facts or an effective date", () => {
    expect(one({ counterparty: "A", object: "B" }, {}, "contract")).toEqual([]);
    expect(one({ description: "x" }, {}, "obligation")).toEqual([]);
    expect(one({ note: "x" }, {}, "other")).toEqual([]);
    expect(one({ date_kind: "effective", date_on: "2026-01-01", notice_days: 30 })).toEqual([]);
  });
});

describe("expiry dates", () => {
  it("an expiry date is an item on that exact day", () => {
    const items = one({ date_kind: "expiry", date_on: "2026-12-31" });
    expect(due(items)).toEqual([["expiry", "2026-12-31", null]]);
    expect(items[0]).toMatchObject({ key: itemKey(FACT, "expiry"), factId: FACT, label: "Arrendamiento", noticeDays: null });
  });

  it("with a calendar notice period adds the last day to give notice", () => {
    expect(due(one({ date_kind: "expiry", date_on: "2026-12-31", notice_days: 30, notice_day_type: "calendar" }))).toEqual([
      ["notice", "2026-12-01", null],
      ["expiry", "2026-12-31", null],
    ]);
    const notice = one({ date_kind: "expiry", date_on: "2026-12-31", notice_days: 30 }).find((item) => item.type === "notice");
    expect(notice).toMatchObject({ baseOn: "2026-12-31", noticeDays: 30 });
  });

  it("a zero-day period falls on the expiry day itself", () => {
    expect(due(one({ date_kind: "expiry", date_on: "2026-12-31", notice_days: 0 }))).toEqual([
      ["expiry", "2026-12-31", null],
      ["notice", "2026-12-31", null],
    ]);
  });

  it("counts back across the end of a month, 29 February and a year change", () => {
    // 31 March minus 31 days: the 28 days of a non-leap February are counted.
    expect(due(one({ date_kind: "renewal_notice", date_on: "2027-03-31", notice_days: 31 }))).toEqual([["notice", "2027-02-28", null]]);
    expect(due(one({ date_kind: "renewal_notice", date_on: "2028-03-31", notice_days: 31 }))).toEqual([["notice", "2028-02-29", null]]);
    expect(due(one({ date_kind: "renewal_notice", date_on: "2028-03-01", notice_days: 1 }))).toEqual([["notice", "2028-02-29", null]]);
    expect(due(one({ date_kind: "renewal_notice", date_on: "2027-01-15", notice_days: 30 }))).toEqual([["notice", "2026-12-16", null]]);
    // "One month" is not a thing here: 31 January minus 30 days is 1 January.
    expect(due(one({ date_kind: "renewal_notice", date_on: "2027-01-31", notice_days: 30 }))).toEqual([["notice", "2027-01-01", null]]);
  });
});

describe("renewal notices", () => {
  it("counts the notice period back from the renewal date", () => {
    expect(due(one({ date_kind: "renewal_notice", date_on: "2027-06-30", notice_days: 90 }))).toEqual([["notice", "2027-04-01", null]]);
  });

  it("without a period the stored date is the notice day itself", () => {
    const items = one({ date_kind: "renewal_notice", date_on: "2027-06-30" });
    expect(due(items)).toEqual([["notice", "2027-06-30", null]]);
    expect(items[0]).toMatchObject({ baseOn: null, noticeDays: null });
  });
});

describe("business days are never computed", () => {
  it("leaves a business-day notice to review, with no date, and keeps the expiry", () => {
    const items = one({ date_kind: "expiry", date_on: "2026-12-31", notice_days: 10, notice_day_type: "business" });
    expect(due(items)).toEqual([
      ["expiry", "2026-12-31", null],
      ["notice", null, "business_days"],
    ]);
    expect(items[1]).toMatchObject({ noticeDays: 10, baseOn: "2026-12-31" });
  });

  it("a business-day renewal notice is review-only, also without a date", () => {
    expect(due(one({ date_kind: "renewal_notice", date_on: "2027-06-30", notice_days: 15, notice_day_type: "business" }))).toEqual([
      ["notice", null, "business_days"],
    ]);
    expect(due(one({ date_kind: "renewal_notice", notice_days: 15, notice_day_type: "business" }))).toEqual([
      ["notice", null, "business_days"],
    ]);
  });
});

describe("missing data gives no date", () => {
  it("a period without a date to count from is left to review", () => {
    expect(due(one({ date_kind: "expiry", notice_days: 30 }))).toEqual([["notice", null, "missing_date"]]);
    expect(due(one({ date_kind: "renewal_notice", notice_days: 30, rule_text: "noventa días" }))).toEqual([["notice", null, "missing_date"]]);
  });

  it("a rule in words with no date is left to review", () => {
    const items = one({ date_kind: "expiry", rule_text: "Vence al cumplir tres años" });
    expect(due(items)).toEqual([["expiry", null, "missing_date"]]);
    expect(items[0].ruleText).toBe("Vence al cumplir tres años");
    expect(due(one({ date_kind: "renewal_notice", rule_text: "con aviso previo" }))).toEqual([["notice", null, "missing_date"]]);
  });

  it("an expiry with neither date nor rule nor period yields nothing", () => {
    expect(one({ date_kind: "expiry" })).toEqual([]);
  });

  it("a date that cannot be moved (out of range) is review, not a wrong date", () => {
    expect(due(one({ date_kind: "renewal_notice", date_on: "1000-01-02", notice_days: 10 }))).toEqual([["notice", null, "missing_date"]]);
  });
});

describe("power of attorney", () => {
  const poa = (data: ProfileFactData) => one({ grantee: "A", scope: "B", ...data }, {}, "power_of_attorney");
  it("is an item on the day it expires", () => {
    expect(due(poa({ granted_on: "2026-01-01", expires_on: "2028-02-29" }))).toEqual([["power_expiry", "2028-02-29", null]]);
  });
  it("has none without an expiration", () => {
    expect(poa({ granted_on: "2026-01-01" })).toEqual([]);
  });
});

describe("order", () => {
  it("lists dated items by date, then those to review", () => {
    const a = fact({ date_kind: "expiry", date_on: "2027-05-01" }, { id: "00000000-0000-4000-8000-00000000000a" });
    const b = fact({ date_kind: "expiry", date_on: "2026-05-01" }, { id: "00000000-0000-4000-8000-00000000000b" });
    const c = fact({ date_kind: "renewal_notice", notice_days: 5 }, { id: "00000000-0000-4000-8000-00000000000c" });
    expect(deriveItems([a, c, b]).map((item) => item.dueOn)).toEqual(["2026-05-01", "2027-05-01", null]);
    const same = fact({ date_kind: "expiry", date_on: "2027-05-01" }, { id: "00000000-0000-4000-8000-00000000000d" });
    expect(deriveItems([same, a]).map((item) => item.factId.slice(-1))).toEqual(["a", "d"]);
  });
});

describe("item keys", () => {
  it("round-trips and refuses anything else", () => {
    expect(parseItemKey(itemKey(FACT, "notice"))).toEqual({ factId: FACT, type: "notice" });
    expect(parseItemKey(itemKey(FACT.toUpperCase(), "expiry"))).toEqual({ factId: FACT, type: "expiry" });
    for (const bad of [null, 5, "", FACT, `${FACT}:other`, `x:expiry`, `${FACT}:expiry:more`])
      expect(parseItemKey(bad), String(bad)).toBeNull();
  });
});

describe("state from events", () => {
  const item = deriveItems([fact({ date_kind: "expiry", date_on: "2026-12-31" })])[0];
  const event = (action: EventRow["action"], extra: Partial<EventRow> = {}): EventRow => ({
    id: `e-${action}-${extra.created_at ?? "1"}`,
    fact_id: FACT,
    item_type: "expiry",
    action,
    due_on: "2026-12-31",
    reason: null,
    actor_user_id: "u",
    created_at: "2026-11-02T00:00:00Z",
    ...extra,
  });
  const view = (events: EventRow[], today = "2026-11-16") => toRadarItem(item, events, today);

  it("is open until somebody acts, then acknowledged, dismissed or done", () => {
    expect(view([])).toMatchObject({ state: "open", acted_by: null, acted_at: null, reason: null, bucket: "later", days_left: 45 });
    expect(view([event("ack")])).toMatchObject({ state: "acknowledged", acted_by: "u" });
    expect(view([event("ack"), event("dismiss", { reason: "No aplica", created_at: "2026-11-03T00:00:00Z" })])).toMatchObject({
      state: "dismissed",
      reason: "No aplica",
    });
    expect(view([event("done")])).toMatchObject({ state: "done", reason: null });
  });

  it("ignores events recorded against another date (the item was recomputed)", () => {
    expect(view([event("done", { due_on: "2026-12-30" })]).state).toBe("open");
    expect(view([event("done", { due_on: null })]).state).toBe("open");
  });

  it("ignores events of other items", () => {
    expect(view([event("done", { item_type: "notice" }), event("done", { fact_id: "other" })]).state).toBe("open");
  });

  it("a review item takes events recorded without a date", () => {
    const review = deriveItems([fact({ date_kind: "renewal_notice", notice_days: 5, notice_day_type: "business" })])[0];
    const open = toRadarItem(review, [], "2026-11-16");
    expect(open).toMatchObject({ bucket: "review", due_on: null, days_left: null, review_reason: "business_days" });
    expect(toRadarItem(review, [event("dismiss", { item_type: "notice", due_on: null, reason: "x" })], "2026-11-16").state).toBe("dismissed");
  });

  it("reports the days left, negative when overdue", () => {
    expect(view([], "2027-01-02")).toMatchObject({ bucket: "overdue", days_left: -2 });
    expect(view([], "2026-12-31")).toMatchObject({ bucket: "next_30", days_left: 0 });
  });
});
