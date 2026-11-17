import { describe, expect, it } from "vitest";
import type { ProfileFact, ProfileFactData, ProfileFactKind } from "@mike/contracts";
import { OBLIGATION_RULES } from "../radar.rules.catalog";
import { anchorChoices, anchorDateOf, applyOps, deriveObligationItems, obligationKey, parseObligationKey, type AnchorMode } from "../radar.obligations";
import type { ObligationRuleDef } from "../radar.rules";
import { fixture } from "./radar.rules.fixture";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fact = (n: number, kind: ProfileFactKind, data: ProfileFactData, over: Partial<ProfileFact> = {}): ProfileFact =>
  ({
    id: uuid(n),
    matter_id: uuid(1),
    kind,
    label: `Dato ${n}`,
    data,
    status: "confirmed",
    stale_reason: null,
    effective_status: "confirmed",
    source: { document_id: "d", version_id: "v", version_number: 1, filename: "c.docx", start_char: 0, end_char: 1, quote: "q", text_sha256: "a".repeat(64) },
    created_by: null,
    created_at: "2026-11-01T00:00:00Z",
    decided_by: null,
    decided_at: null,
    events: [],
    ...over,
  }) as ProfileFact;
const dateFact = (date: string, over: Partial<ProfileFact> = {}) => fact(1, "date", { date_kind: "effective", date_on: date }, over);
const catalog = (code: string) => OBLIGATION_RULES.find((rule) => rule.code === code)!;

/** The item of a catalog rule counted from `date`, as [due, opens, review reason]. */
function count(code: string, date: string, mode: AnchorMode = "direct") {
  const [item] = deriveObligationItems([{ rule: catalog(code), anchorFactId: uuid(1), mode }], [dateFact(date)]);
  return [item.dueOn, item.startsOn, item.reviewReason];
}

// Dates computed by hand from the law's wording, not from the engine.
describe("catalog rules with dates worked out by hand", () => {
  it("asamblea ordinaria anual: closing of the year, 31 December, + 4 months → 30 April", () => {
    expect(count("lgsm.asamblea_ordinaria_anual", "2026-12-31")).toEqual(["2027-04-30", null, null]);
  });

  it("PTU: the tax return's due date, + 3 months, then + 60 days (31 Dec 2026 → 31 Mar → 30 May 2027)", () => {
    expect(count("lft.ptu_reparto", "2026-12-31")).toEqual(["2027-05-30", null, null]);
    // The order matters: 30 Nov + 3 months = 28 Feb (not leap), + 60 days = 29 April.
    expect(count("lft.ptu_reparto", "2026-11-30")).toEqual(["2027-04-29", null, null]);
  });

  it("REPSE: a window of whole months, from the first of month 33 to the last of month 35 (registered 20 Jun 2024 → 1 Mar to 31 May 2027)", () => {
    expect(count("lft.repse_renovacion", "2024-06-20")).toEqual(["2027-05-31", "2027-03-01", null]);
    // Month 35 ends in a 30-day month: registered 15 Jan 2024 → +35 months = Dec 2026 → 31 Dec.
    expect(count("lft.repse_renovacion", "2024-01-15")).toEqual(["2026-12-31", "2026-10-01", null]);
    // Leap February: registered 31 Mar 2025 → +33 months = 31 Dec 2027 → 1 Dec; +35 = 28 Feb 2028 clamped (no 31 Feb) → fin_mes 29 Feb.
    expect(count("lft.repse_renovacion", "2025-03-31")).toEqual(["2028-02-29", "2027-12-01", null]);
  });

  it("marca: renewal opens 6 months before the expiry and closes on it (expiry 15 Aug 2029 → 15 Feb 2029 to 15 Aug 2029)", () => {
    expect(count("lfppi.marca_renovacion", "2029-08-15")).toEqual(["2029-08-15", "2029-02-15", null]);
    // A 31 August expiry: 6 months before is 28 February (end-of-month rule), 29 in a leap year.
    expect(count("lfppi.marca_renovacion", "2029-08-31")).toEqual(["2029-08-31", "2029-02-28", null]);
    expect(count("lfppi.marca_renovacion", "2028-08-31")).toEqual(["2028-08-31", "2028-02-29", null]);
  });

  it("marca, first cycle: from the grant date + 10 years (granted 15 Aug 2019 → expires 15 Aug 2029)", () => {
    expect(count("lfppi.marca_renovacion", "2019-08-15", "first_cycle")).toEqual(["2029-08-15", "2029-02-15", null]);
    // Without the first-cycle step the grant date itself would be taken as the expiry.
    expect(count("lfppi.marca_renovacion", "2019-08-15")).toEqual(["2019-08-15", "2019-02-15", null]);
  });

  it("e.firma: 4 years from the issue date, also from 29 February", () => {
    expect(count("cff.efirma_vencimiento", "2024-02-29")).toEqual(["2028-02-29", null, null]);
    expect(count("cff.efirma_vencimiento", "2096-02-29")).toEqual(["2100-02-28", null, null]);
    expect(count("cff.efirma_vencimiento", "2026-11-17")).toEqual(["2030-11-17", null, null]);
  });

  it("SAS financial report: from 1 March to 31 March after the close (31 Dec 2026 → 2027)", () => {
    expect(count("lgsm.sas_informe_financiero_anual", "2026-12-31")).toEqual(["2027-03-31", "2027-03-01", null]);
  });

  it("CCT salary review, counted back: last revision 1 Mar 2026 + 1 year − 30 days → 30 Jan 2027", () => {
    expect(count("lft.cct_revision_salarial", "2026-03-01")).toEqual(["2027-01-30", null, null]);
    expect(count("lft.cct_revision_integral", "2025-06-15")).toEqual(["2027-04-16", null, null]);
  });

  it("notice published 15 days before the assembly, across a year change (assembly 10 Jan 2027 → 26 Dec 2026)", () => {
    expect(count("lgsm.convocatoria_asamblea", "2027-01-10")).toEqual(["2026-12-26", null, null]);
    expect(count("lgsm.informe_administradores_disposicion", "2027-03-01")).toEqual(["2027-02-14", null, null]);
  });

  it("marca, declaration of use: from the third anniversary to 3 months more (granted 15 Aug 2023 → 15 Aug to 15 Nov 2026)", () => {
    expect(count("lfppi.marca_declaracion_uso", "2023-08-15")).toEqual(["2026-11-15", "2026-08-15", null]);
    expect(count("lfppi.marca_declaracion_uso", "2020-02-29")).toEqual(["2023-05-28", "2023-02-28", null]);
  });

  it("grace period and the two reserve-of-rights windows", () => {
    expect(count("lfppi.signo_renovacion_gracia", "2029-08-15")).toEqual(["2030-02-15", "2029-08-16", null]);
    expect(count("lfda.reserva_derechos_renovacion_anual", "2027-02-01")).toEqual(["2027-03-01", "2027-01-01", null]);
    expect(count("lfda.reserva_derechos_renovacion_quinquenal", "2027-03-31")).toEqual(["2027-04-30", "2027-02-28", null]);
  });

  it("never computes business days: the SAS assembly notice has no date", () => {
    const [item] = deriveObligationItems([{ rule: catalog("lgsm.sas_convocatoria_asamblea"), anchorFactId: uuid(1), mode: "direct" }], [dateFact("2027-04-30")]);
    expect(item).toMatchObject({ dueOn: null, startsOn: null, reviewReason: "business_days", baseOn: "2027-04-30" });
  });

  it("computes every other rule from a plain date, with no rule left without a date", () => {
    for (const rule of OBLIGATION_RULES) {
      const [item] = deriveObligationItems([{ rule, anchorFactId: uuid(1), mode: "direct" }], [dateFact("2026-11-17")]);
      if (rule.code === "lgsm.sas_convocatoria_asamblea") expect(item.reviewReason).toBe("business_days");
      else expect(item, rule.code).toMatchObject({ reviewReason: null, dueOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
      expect(item.startsOn === null, rule.code).toBe(rule.kind !== "window");
    }
  });
});

describe("operations", () => {
  it("apply in the order given, with the end-of-month rule at each step", () => {
    expect(applyOps("2026-01-31", [{ unit: "months", amount: 1 }, { unit: "days", amount: 1 }])).toBe("2026-03-01");
    expect(applyOps("2026-01-31", [{ unit: "days", amount: 1 }, { unit: "months", amount: 1 }])).toBe("2026-03-01");
    expect(applyOps("2026-01-30", [{ unit: "months", amount: 1 }, { adjust: "month_start" }])).toBe("2026-02-01");
    expect(applyOps("2026-02-10", [{ adjust: "month_end" }])).toBe("2026-02-28");
    expect(applyOps("2028-02-10", [{ adjust: "month_end" }])).toBe("2028-02-29");
    expect(applyOps("2026-02-10", [])).toBe("2026-02-10");
  });

  it("answer null for business days, a date out of range and a thing that is not an operation", () => {
    expect(applyOps("2026-01-31", [{ unit: "business_days", amount: -5 }])).toBeNull();
    expect(applyOps("9999-12-31", [{ unit: "days", amount: 1 }])).toBeNull();
    expect(applyOps("9999-12-31", [{ unit: "days", amount: 1 }, { adjust: "month_start" }])).toBeNull();
    expect(applyOps("2026-01-31", [{ adjust: "week_start" as never }])).toBeNull();
  });
});

describe("what an item says when its anchor does not count", () => {
  const active = (rule: ObligationRuleDef = catalog("lgsm.asamblea_ordinaria_anual"), mode: AnchorMode = "direct") => [{ rule, anchorFactId: uuid(1), mode }];

  it("goes to review, with no date and no source, when the fact is pending, rejected, stale or gone", () => {
    const cases = [
      dateFact("2026-12-31", { status: "pending", effective_status: "pending" }),
      dateFact("2026-12-31", { status: "rejected", effective_status: "rejected" }),
      dateFact("2026-12-31", { stale_reason: "text_changed", effective_status: "stale" }),
    ];
    for (const stale of cases) {
      const [item] = deriveObligationItems(active(), [stale]);
      expect(item, stale.status).toMatchObject({ dueOn: null, startsOn: null, reviewReason: "anchor_unavailable", source: null, factId: uuid(1) });
    }
    expect(deriveObligationItems(active(), [])[0]).toMatchObject({ reviewReason: "anchor_unavailable", label: "lgsm.asamblea_ordinaria_anual" });
    // A fact that is not a date fact cannot anchor a rule.
    expect(deriveObligationItems(active(), [fact(1, "contract", { counterparty: "A" })])[0].reviewReason).toBe("anchor_unavailable");
  });

  it("goes to review when the fact has no usable date, or the result leaves the supported years", () => {
    expect(deriveObligationItems(active(), [fact(1, "date", { date_kind: "expiry", rule_text: "a la vista" })])[0]).toMatchObject({ dueOn: null, reviewReason: "missing_date" });
    expect(deriveObligationItems(active(), [fact(1, "date", { date_kind: "expiry", date_on: "no es fecha" })])[0].reviewReason).toBe("missing_date");
    expect(deriveObligationItems(active(), [dateFact("9999-12-31")])[0]).toMatchObject({ dueOn: null, reviewReason: "missing_date", baseOn: "9999-12-31" });
    const window = catalog("lft.repse_renovacion");
    expect(deriveObligationItems(active(window), [dateFact("9999-12-31")])[0].reviewReason).toBe("missing_date");
    const marca = catalog("lfppi.marca_renovacion");
    expect(deriveObligationItems(active(marca, "first_cycle"), [dateFact("9999-01-01")])[0]).toMatchObject({ reviewReason: "missing_date", baseOn: "9999-01-01" });
  });

  it("uses first_cycle only when the rule has one; otherwise it counts from the date as it is", () => {
    const plain = catalog("lgsm.asamblea_ordinaria_anual");
    expect(deriveObligationItems(active(plain, "first_cycle"), [dateFact("2026-12-31")])[0].dueOn).toBe("2027-04-30");
  });

  it("is one item per active rule, nothing for no active rule, and names the anchor in its key", () => {
    expect(deriveObligationItems([], [dateFact("2026-12-31")])).toEqual([]);
    const two = [...active(), { rule: catalog("cff.efirma_vencimiento"), anchorFactId: uuid(2), mode: "direct" as const }];
    const items = deriveObligationItems(two, [dateFact("2026-12-31"), fact(2, "date", { date_kind: "effective", date_on: "2024-02-29" })]);
    expect(items.map((item) => item.key)).toEqual([`lgsm.asamblea_ordinaria_anual@1:${uuid(1)}`, `cff.efirma_vencimiento@1:${uuid(2)}`]);
    expect(items.map((item) => item.dueOn)).toEqual(["2027-04-30", "2028-02-29"]);
  });
});

describe("anchors and keys", () => {
  it("offers the confirmed, not stale facts that have a date", () => {
    const facts = [
      dateFact("2026-12-31"),
      fact(2, "date", { date_kind: "expiry" }),
      fact(3, "date", { date_kind: "expiry", date_on: "2026-13-45" }),
      fact(4, "contract", { counterparty: "A" }),
      fact(5, "date", { date_kind: "expiry", date_on: "2026-12-31" }, { status: "pending", effective_status: "pending" }),
      fact(6, "date", { date_kind: "expiry", date_on: "2026-12-31" }, { stale_reason: "text_changed", effective_status: "stale" }),
      fact(7, "power_of_attorney", { expires_on: "2027-01-01" }),
    ];
    expect(anchorChoices(facts).map((entry) => entry.id)).toEqual([uuid(1)]);
    expect(anchorDateOf(facts[0])).toBe("2026-12-31");
    expect(anchorDateOf(facts[6])).toBeNull();
  });

  it("names items rule@version:anchor and reads the name back", () => {
    expect(obligationKey(fixture, uuid(7))).toBe(`fixture.notice@1:${uuid(7)}`);
    expect(parseObligationKey(`Fixture.Notice@1:${uuid(7).toUpperCase()}`)).toEqual({ ruleKey: "fixture.notice@1", anchor: uuid(7) });
    for (const bad of ["fixture.notice@1", "fixture.notice@1:", "fixture.notice@1:matter", "notice@1:x", `${uuid(7)}:expiry`, "fixture.notice@0:" + uuid(7), 5, null])
      expect(parseObligationKey(bad), String(bad)).toBeNull();
  });
});
