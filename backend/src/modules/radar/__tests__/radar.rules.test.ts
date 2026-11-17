import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OBLIGATION_RULES, RAW_CATALOG, catalogKey, ruleOf, type RawRule } from "../radar.rules.catalog";
import {
  catalogProblems,
  findRule,
  hasBusinessDays,
  isUsable,
  parseRuleKey,
  ruleKey,
  ruleProblems,
  type ObligationRuleDef,
} from "../radar.rules";
import { fixture } from "./radar.rules.fixture";

const messages = (locale: string) =>
  JSON.parse(readFileSync(resolve(__dirname, `../../../../../packages/i18n/messages/${locale}.json`), "utf8"));
const lookup = (tree: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);

const with_ = (over: Partial<ObligationRuleDef>): ObligationRuleDef => ({ ...fixture, ...over });

describe("the shipped catalog (legal's batch 1, loaded as data)", () => {
  it("has the 20 rules legal verified, each with its quote, law, official URL and last reform", () => {
    expect(RAW_CATALOG.reglas).toHaveLength(20);
    expect(OBLIGATION_RULES).toHaveLength(20);
    expect(catalogProblems(OBLIGATION_RULES)).toEqual([]);
    for (const raw of RAW_CATALOG.reglas) {
      expect(raw.estado, raw.codigo).toBe("verificada");
      expect(raw.citas.length, raw.codigo).toBeGreaterThan(0);
      for (const cita of raw.citas) {
        expect(cita.texto.trim(), raw.codigo).not.toBe("");
        expect(cita.ley.trim(), raw.codigo).not.toBe("");
        expect(cita.ubicacion.trim(), raw.codigo).not.toBe("");
        expect(cita.url, raw.codigo).toMatch(/^https:\/\/(www\.diputados\.gob\.mx|sidof\.segob\.gob\.mx)\//);
        expect(cita.ultima_reforma, raw.codigo).toMatch(/^DOF \d{2}-\d{2}-\d{4}/);
      }
      expect(raw.fecha_consulta, raw.codigo).toBe("2026-11-17");
    }
    for (const rule of OBLIGATION_RULES) expect(isUsable(rule), ruleKey(rule)).toBe(true);
  });

  it("uses only the operations, milestones and kinds the engine knows", () => {
    const opKeys = new Set(RAW_CATALOG.reglas.flatMap((rule) => rule.calculo.flatMap((milestone) => milestone.ops.flatMap((op) => Object.keys(op)))));
    expect([...opKeys].sort()).toEqual(["ajuste", "anios", "dias", "dias_habiles", "meses"]);
    expect(new Set(RAW_CATALOG.reglas.map((rule) => rule.tipo))).toEqual(new Set(["plazo", "ventana", "vencimiento"]));
    expect(new Set(RAW_CATALOG.reglas.flatMap((rule) => rule.calculo.map((milestone) => milestone.hito)))).toEqual(new Set(["vence", "apertura", "cierre"]));
  });

  it("keeps the quotes exactly as legal delivered them", () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, "../data/radar_catalogo_s5_lote1.json"), "utf8"));
    expect(RAW_CATALOG).toEqual(file);
    const first = OBLIGATION_RULES.find((rule) => rule.code === "lgsm.asamblea_ordinaria_anual")!;
    expect(first.citations[0].text).toBe(
      "La Asamblea Ordinaria se reunirá por lo menos una vez al año dentro de los cuatro meses que sigan a la clausura del ejercicio social y se ocupará, además de los asuntos incluidos en la orden del día, de los siguientes:",
    );
    expect(first.citations.map((cita) => cita.location)).toEqual(["Art. 181, párrafo primero", "Art. 8o.-A, párrafo primero"]);
  });

  it("flags the business-day rule, and only that one", () => {
    expect(OBLIGATION_RULES.filter(hasBusinessDays).map((rule) => rule.code)).toEqual(["lgsm.sas_convocatoria_asamblea"]);
  });

  it("words every rule in both languages, as legal wrote it in Spanish (name, when it applies, date it counts from)", () => {
    for (const rule of OBLIGATION_RULES) {
      const raw = RAW_CATALOG.reglas.find((entry) => entry.codigo === rule.code)!;
      for (const locale of ["es-MX", "en-US"] as const) {
        const tree = messages(locale);
        for (const key of [rule.nameKey, rule.appliesWhenKey, rule.anchorKey])
          expect(typeof lookup(tree, key), `${locale} ${key}`).toBe("string");
        if (rule.firstCycle) expect(typeof lookup(tree, `radar.rules.firstCycleFrom.${rule.firstCycle.from}`), `${locale} ${rule.firstCycle.from}`).toBe("string");
      }
      const es = messages("es-MX");
      expect(lookup(es, rule.nameKey), rule.code).toBe(raw.nombre);
      expect(lookup(es, rule.appliesWhenKey), rule.code).toBe(raw.aplica);
      expect(lookup(es, rule.anchorKey), rule.code).toBe(raw.dato_partida);
    }
  });

  it("names i18n keys from the code", () => {
    expect(catalogKey("lgsm.asamblea_ordinaria_anual")).toBe("radar.rules.catalog.lgsm_asamblea_ordinaria_anual");
  });
});

describe("loading a rule", () => {
  const raw = (): RawRule => structuredClone(RAW_CATALOG.reglas[0]);
  it("loads a rule that is not 'verificada' as unverified, which cannot be used", () => {
    const rule = ruleOf({ ...raw(), estado: "borrador" });
    expect(rule.verification).toEqual({ status: "unverified" });
    expect(isUsable(rule)).toBe(false);
  });

  it("makes an operation or a kind it does not know fail validation instead of loading half-read", () => {
    const odd = raw();
    odd.calculo[0].ops = [{ semanas: 2 }];
    expect(ruleProblems(ruleOf(odd)).join()).toMatch(/operation unit/);
    const adjust = raw();
    adjust.calculo[0].ops = [{ ajuste: "mitad_de_mes" }];
    expect(ruleProblems(ruleOf(adjust)).join()).toMatch(/adjust must be/);
    expect(ruleProblems(ruleOf({ ...raw(), tipo: "otro" })).join()).toMatch(/kind must be/);
    const milestone = raw();
    milestone.calculo[0].hito = "pronto";
    expect(ruleProblems(ruleOf(milestone)).join()).toMatch(/exactly one due/);
  });

  it("keeps the first-cycle derivation, with its condition and cap, and legal's notes", () => {
    const design = OBLIGATION_RULES.find((rule) => rule.code === "lfppi.diseno_industrial_renovacion")!;
    expect(design.firstCycle).toEqual({ from: "fecha_presentacion_solicitud", ops: [{ unit: "years", amount: 5 }], capYears: 25 });
    const mark = OBLIGATION_RULES.find((rule) => rule.code === "lfppi.marca_renovacion")!;
    expect(mark.firstCycle).toMatchObject({ from: "fecha_otorgamiento_registro", onlyIf: "otorgado desde 2018-08-10" });
    expect(mark.notes).toMatch(/Registros otorgados antes del 10-08-2018/);
    expect(OBLIGATION_RULES.find((rule) => rule.code === "cff.efirma_vencimiento")!.kind).toBe("expiry");
    expect(OBLIGATION_RULES.find((rule) => rule.code === "lgsm.asamblea_ordinaria_anual")!.firstCycle).toBeUndefined();
    expect(ruleOf({ ...raw(), notas: null }).notes).toBeUndefined();
  });
});

describe("rule validation", () => {
  it("accepts a sound verified rule and a sound unverified placeholder", () => {
    expect(ruleProblems(fixture)).toEqual([]);
    const draft = with_({ verification: { status: "unverified" }, citations: [] });
    expect(ruleProblems(draft)).toEqual([]);
    expect(isUsable(fixture)).toBe(true);
    expect(isUsable(draft)).toBe(false);
  });

  it("requires a verified rule to have its citations: law, location, quote, https URL, last reform, and who verified it", () => {
    const cite = fixture.citations[0];
    const cases: [Partial<ObligationRuleDef>, RegExp][] = [
      [{ citations: [] }, /at least one citation/],
      [{ citations: [{ ...cite, text: " " }] }, /literal quote/],
      [{ citations: [{ ...cite, law: "" }] }, /law and location/],
      [{ citations: [{ ...cite, location: "" }] }, /law and location/],
      [{ citations: [{ ...cite, url: "" }] }, /https url/],
      [{ citations: [{ ...cite, url: "http://example.gob.mx" }] }, /https url/],
      [{ citations: [{ ...cite, url: "https://" }] }, /https url/],
      [{ citations: [{ ...cite, lastReform: "" }] }, /lastReform/],
      [{ citations: [{ ...cite, lastReform: "2023" }] }, /lastReform/],
      [{ verification: { status: "verified", verifiedBy: "", verifiedOn: "2026-11-17" } }, /verifiedBy/],
      [{ verification: { status: "verified", verifiedBy: "x", verifiedOn: "17/11/2026" } }, /verifiedOn/],
      [{ consultedOn: "2026-02-30" }, /consultedOn/],
    ];
    for (const [over, message] of cases) {
      expect(ruleProblems(with_(over)).join("\n")).toMatch(message);
      expect(isUsable(with_(over))).toBe(false);
    }
  });

  it("rejects a malformed code, version, keys and verification status", () => {
    for (const code of ["Contract.x", "contract", `a.${"b".repeat(80)}`]) expect(ruleProblems(with_({ code })).join()).toMatch(/code must look like/);
    for (const version of [0, 1.5, 1_000_000]) expect(ruleProblems(with_({ version })).join()).toMatch(/version/);
    expect(ruleProblems(with_({ nameKey: " " })).join()).toMatch(/nameKey/);
    expect(ruleProblems(with_({ appliesWhenKey: "" })).join()).toMatch(/appliesWhenKey/);
    expect(ruleProblems(with_({ anchorKey: "" })).join()).toMatch(/anchor needs/);
    expect(ruleProblems(with_({ anchorName: "" })).join()).toMatch(/anchor needs/);
    expect(ruleProblems(with_({ verification: { status: "maybe" } as never })).join()).toMatch(/verification\.status/);
  });

  it("checks operations: calendar days, months and years, business days (never computed) and month adjustments", () => {
    const due = (ops: unknown[]) => with_({ milestones: [{ kind: "due", ops: ops as never }] });
    expect(ruleProblems(due([{ unit: "days", amount: -30 }, { unit: "months", amount: 2 }, { adjust: "month_end" }, { adjust: "month_start" }]))).toEqual([]);
    expect(ruleProblems(due([]))).toEqual([]);
    expect(ruleProblems(due([{ unit: "weeks", amount: 1 }])).join()).toMatch(/unit must be/);
    expect(ruleProblems(due([{ unit: "days", amount: 1.5 }])).join()).toMatch(/whole number/);
    expect(ruleProblems(due([{ unit: "days", amount: 100000 }])).join()).toMatch(/whole number/);
    expect(ruleProblems(due([{ unit: "business_days", amount: 0 }])).join()).toMatch(/whole number/);
    expect(ruleProblems(due([{ adjust: "week_end" }])).join()).toMatch(/adjust must be/);
    expect(ruleProblems(due([null])).join()).toMatch(/must be an object/);
    // Counting business days obliges the rule to say so.
    expect(ruleProblems(due([{ unit: "business_days", amount: -5 }])).join()).toMatch(/requiresBusinessDays must be true/);
    const honest = with_({ milestones: [{ kind: "due", ops: [{ unit: "business_days", amount: -5 }] }], requiresBusinessDays: true });
    expect(ruleProblems(honest)).toEqual([]);
    expect(hasBusinessDays(honest)).toBe(true);
    expect(hasBusinessDays(with_({ requiresBusinessDays: true }))).toBe(true);
    expect(hasBusinessDays(with_({ firstCycle: { from: "x", ops: [{ unit: "business_days", amount: 1 }] } }))).toBe(true);
    expect(hasBusinessDays(fixture)).toBe(false);
  });

  it("makes a window open and close, and a deadline or an expiry have one due milestone", () => {
    const window = (kinds: string[]) => with_({ kind: "window", milestones: kinds.map((kind) => ({ kind, ops: [] })) as never });
    expect(ruleProblems(window(["opens", "closes"]))).toEqual([]);
    expect(ruleProblems(window(["closes", "opens"])).join()).toMatch(/exactly an opens and a closes/);
    expect(ruleProblems(window(["due"])).join()).toMatch(/exactly an opens and a closes/);
    expect(ruleProblems(with_({ milestones: [] })).join()).toMatch(/exactly one due/);
    expect(ruleProblems(with_({ kind: "expiry" }))).toEqual([]);
    expect(ruleProblems(with_({ kind: "span" as never })).join()).toMatch(/kind must be/);
    expect(ruleProblems(with_({ milestones: [{ kind: "due", ops: "x" as never }] })).join()).toMatch(/list of operations/);
  });

  it("checks the first-cycle derivation", () => {
    expect(ruleProblems(with_({ firstCycle: { from: "fecha_otorgamiento", ops: [{ unit: "years", amount: 10 }] } }))).toEqual([]);
    expect(ruleProblems(with_({ firstCycle: { from: "", ops: [{ unit: "years", amount: 10 }] } })).join()).toMatch(/firstCycle\.from/);
    expect(ruleProblems(with_({ firstCycle: { from: "x", ops: [] } })).join()).toMatch(/needs operations/);
    expect(ruleProblems(with_({ firstCycle: { from: "x", ops: [{ unit: "years", amount: 0.5 }] } })).join()).toMatch(/firstCycle: /);
  });

  it("finds a rule listed twice", () => {
    expect(catalogProblems([fixture, fixture])).toEqual(["fixture.notice@1: listed twice"]);
    expect(catalogProblems([fixture, with_({ version: 2 })])).toEqual([]);
  });
});

describe("rule keys", () => {
  it("names a rule by code and version and reads the name back", () => {
    expect(ruleKey(fixture)).toBe("fixture.notice@1");
    expect(parseRuleKey("lgsm.asamblea_ordinaria_anual@1")).toEqual({ code: "lgsm.asamblea_ordinaria_anual", version: 1 });
    for (const bad of ["contract.notice", "contract@1", "Contract.Notice@1", "contract.notice@0", "contract.notice@01", "contract.notice@1:matter", "contract.notice@1234567", "", 5, null, undefined])
      expect(parseRuleKey(bad), String(bad)).toBeNull();
  });

  it("finds a rule by key", () => {
    expect(findRule(OBLIGATION_RULES, "cff.efirma_vencimiento@1")?.code).toBe("cff.efirma_vencimiento");
    expect(findRule(OBLIGATION_RULES, "cff.efirma_vencimiento@2")).toBeNull();
    expect(findRule(OBLIGATION_RULES, "nonsense")).toBeNull();
  });
});
