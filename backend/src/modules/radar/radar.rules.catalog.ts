/**
 * The catalog of obligation rules (docs/obligation-rules.md): DATA, read from
 * data/radar_catalogo_s5_lote1.json exactly as legal verified it (Spanish field
 * names, literal quotes untouched). This file only maps those fields to the
 * engine's types; it holds no rule and no legal text.
 *
 * To add or change a rule: edit the JSON (a changed rule gets a new `version`),
 * add its name, "applies when" and "counts from" sentences to packages/i18n
 * (es-MX and en-US, under radar.rules.catalog.<code with dots as underscores>),
 * and run the backend tests: radar.rules.test.ts validates every rule. No code
 * changes. A rule whose `estado` is not "verificada" loads as unverified and
 * cannot be turned on.
 */

import raw from "./data/radar_catalogo_s5_lote1.json";
import type { ObligationRuleDef, RuleCitation, RuleFirstCycle, RuleKind, RuleMilestone, RuleOp, RuleUnit } from "./radar.rules";

/** The catalog as delivered. Only the fields the engine reads are typed. */
export type RawOp = Record<string, number | string>;
export type RawRule = {
  codigo: string;
  nombre: string;
  aplica: string;
  dato_partida: string;
  ancla: string;
  derivar_ancla_primer_ciclo: null | { desde: string; ops: RawOp[]; solo_si?: string; tope?: { anios: number } };
  tipo: string;
  calculo: { hito: string; ops: RawOp[] }[];
  requiere_habiles: boolean;
  citas: { fuente: string; ley: string; ubicacion: string; texto: string; url: string; ultima_reforma: string }[];
  notas: string | null;
  estado: string;
  fecha_consulta: string;
};
export const RAW_CATALOG = raw as unknown as { version: string; fecha_corte: string; reglas: RawRule[] };

const UNIT_OF: Record<string, RuleUnit> = { dias: "days", meses: "months", anios: "years", dias_habiles: "business_days" };
const KIND_OF: Record<string, RuleKind> = { plazo: "deadline", ventana: "window", vencimiento: "expiry" };
const MILESTONE_OF: Record<string, RuleMilestone["kind"]> = { vence: "due", apertura: "opens", cierre: "closes" };
const ADJUST_OF: Record<string, "month_start" | "month_end"> = { inicio_mes: "month_start", fin_mes: "month_end" };

/** An operation the engine does not know maps to a unit it rejects, so the rule fails validation instead of loading half-read. */
function opOf(op: RawOp): RuleOp {
  const [key] = Object.keys(op);
  if (key === "ajuste") return { adjust: ADJUST_OF[String(op.ajuste)] ?? ("unknown" as never) };
  return { unit: UNIT_OF[key] ?? (key as RuleUnit), amount: Number(op[key]) };
}

/** `lgsm.asamblea_ordinaria_anual` → the i18n key stem `radar.rules.catalog.lgsm_asamblea_ordinaria_anual`. */
export const catalogKey = (code: string) => `radar.rules.catalog.${code.replaceAll(".", "_")}`;

export function ruleOf(rule: RawRule): ObligationRuleDef {
  const first = rule.derivar_ancla_primer_ciclo;
  const firstCycle: RuleFirstCycle | undefined = first
    ? { from: first.desde, ops: first.ops.map(opOf), ...(first.solo_si ? { onlyIf: first.solo_si } : {}), ...(first.tope ? { capYears: first.tope.anios } : {}) }
    : undefined;
  const citations: RuleCitation[] = rule.citas.map((cita) => ({
    sourceCode: cita.fuente,
    law: cita.ley,
    location: cita.ubicacion,
    text: cita.texto,
    url: cita.url,
    lastReform: cita.ultima_reforma,
  }));
  return {
    code: rule.codigo,
    version: 1,
    nameKey: `${catalogKey(rule.codigo)}.name`,
    appliesWhenKey: `${catalogKey(rule.codigo)}.appliesWhen`,
    anchorKey: `${catalogKey(rule.codigo)}.anchor`,
    anchorName: rule.ancla,
    ...(firstCycle ? { firstCycle } : {}),
    kind: KIND_OF[rule.tipo] ?? (rule.tipo as RuleKind),
    milestones: rule.calculo.map((milestone) => ({ kind: MILESTONE_OF[milestone.hito] ?? (milestone.hito as RuleMilestone["kind"]), ops: milestone.ops.map(opOf) })),
    requiresBusinessDays: rule.requiere_habiles === true,
    citations,
    ...(rule.notas ? { notes: rule.notas } : {}),
    consultedOn: rule.fecha_consulta,
    // Legal's review is the catalog's own state; the reviewer is the legal team, on the consultation date.
    verification:
      rule.estado === "verificada"
        ? { status: "verified", verifiedBy: "socium-legal", verifiedOn: rule.fecha_consulta }
        : { status: "unverified" },
  };
}

export const OBLIGATION_RULES: readonly ObligationRuleDef[] = RAW_CATALOG.reglas.map(ruleOf);
