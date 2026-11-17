/**
 * The obligation rules: a catalog, versioned in code, of obligations whose
 * dates are counted from a date in the client profile
 * (docs/obligation-rules.md).
 *
 * Pure module: types, validation and lookup. The DATA is the catalog JSON
 * (data/radar_catalogo_s5_lote1.json, as legal delivered it) read by
 * radar.rules.catalog.ts, so adding or changing a rule is editing data, not
 * code. A rule counts from an anchor: a date the lawyer picks among the
 * confirmed facts of the matter when turning the rule on. Its milestones are
 * chains of operations in order: calendar days, months and years (end-of-month
 * rule in radar.dates.ts), an adjustment to the first or last day of the month,
 * or business days, which LiTT never computes.
 *
 * A rule is `verified` only when a lawyer checked it against the official
 * source and the entry says who and when. Only a verified rule can be turned
 * on for a matter. A model never writes a rule, an operation or a date.
 */

import { isIsoDate } from "./radar.dates";

/** `deadline`: one last day. `window`: opens and closes. `expiry`: a validity that ends. */
export type RuleKind = "deadline" | "window" | "expiry";
export type RuleUnit = "days" | "months" | "years" | "business_days";
export type RuleOp = { unit: RuleUnit; /** Signed: negative counts back. */ amount: number } | { adjust: "month_start" | "month_end" };
export type RuleMilestone = { kind: "due" | "opens" | "closes"; ops: RuleOp[] };
export type RuleCitation = {
  /** Short code of the source, as the catalog names it (LGSM, LFT…). */
  sourceCode: string;
  law: string;
  /** Article and paragraph. */
  location: string;
  /** The words of the law, as the official source gives them. */
  text: string;
  url: string;
  /** As the official source states it, e.g. `DOF 20-10-2023`. */
  lastReform: string;
};
/** How the first anchor is worked out when the lawyer has only the date the right was granted. */
export type RuleFirstCycle = {
  /** Name of the date it starts from (an i18n key suffix). */
  from: string;
  ops: RuleOp[];
  /** A condition, in words, the lawyer checks (not computed). */
  onlyIf?: string;
  /** An absolute cap in years, in words for the lawyer (not computed). */
  capYears?: number;
};
export type RuleVerification =
  | { status: "unverified" }
  | { status: "verified"; verifiedBy: string; verifiedOn: string };

export type ObligationRuleDef = {
  /** `<area>.<name>`, lower case, e.g. `lgsm.asamblea_ordinaria_anual`. */
  code: string;
  /** Raised whenever the rule changes; a new version starts switched off in every matter. */
  version: number;
  /** i18n keys of the rule's name, of when it applies, and of the date it counts from. */
  nameKey: string;
  appliesWhenKey: string;
  anchorKey: string;
  /** Machine name of the anchor, as the catalog gives it. */
  anchorName: string;
  firstCycle?: RuleFirstCycle;
  kind: RuleKind;
  milestones: RuleMilestone[];
  /** Counts business days somewhere: never computed, the item is left to review. */
  requiresBusinessDays: boolean;
  citations: RuleCitation[];
  /** Legal's notes (plain text), shown with the rule. */
  notes?: string;
  /** ISO date the official sources were consulted. */
  consultedOn: string;
  verification: RuleVerification;
};

export const CODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const KEY_PATTERN = /^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)@([1-9][0-9]{0,5})$/;
const UNITS: readonly string[] = ["days", "months", "years", "business_days"];
const MAX_AMOUNT = 1000;

export const ruleKey = (rule: Pick<ObligationRuleDef, "code" | "version">) => `${rule.code}@${rule.version}`;

/** `<code>@<version>` back into its parts, or null. */
export function parseRuleKey(key: unknown): { code: string; version: number } | null {
  if (typeof key !== "string") return null;
  const match = KEY_PATTERN.exec(key);
  return match ? { code: match[1], version: Number(match[2]) } : null;
}

const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export const isBusinessOp = (op: RuleOp): boolean => "unit" in op && op.unit === "business_days";
export const hasBusinessDays = (rule: Pick<ObligationRuleDef, "milestones" | "requiresBusinessDays" | "firstCycle">): boolean =>
  rule.requiresBusinessDays ||
  rule.milestones.some((milestone) => milestone.ops.some(isBusinessOp)) ||
  (rule.firstCycle?.ops.some(isBusinessOp) ?? false);

function opProblems(op: RuleOp | undefined): string | null {
  if (!op || typeof op !== "object") return "an operation must be an object";
  if ("adjust" in op) return op.adjust === "month_start" || op.adjust === "month_end" ? null : "adjust must be month_start or month_end";
  if (!UNITS.includes(op.unit)) return "an operation unit must be days, months, years or business_days";
  if (typeof op.amount !== "number" || !Number.isInteger(op.amount) || Math.abs(op.amount) > MAX_AMOUNT || (op.unit === "business_days" && op.amount === 0))
    return "an operation amount must be a whole number";
  return null;
}

/** What is wrong with one rule, in words for the engineer; empty when it is sound. */
export function ruleProblems(rule: ObligationRuleDef): string[] {
  const problems: string[] = [];
  const where = `${rule.code}@${rule.version}`;
  const bad = (message: string) => problems.push(`${where}: ${message}`);

  if (!CODE_PATTERN.test(rule.code) || rule.code.length > 80) bad("code must look like area.name");
  if (!Number.isInteger(rule.version) || rule.version < 1 || rule.version > 999_999) bad("version must be a positive integer");
  if (!filled(rule.nameKey)) bad("nameKey is required");
  if (!filled(rule.appliesWhenKey)) bad("appliesWhenKey is required");
  if (!filled(rule.anchorKey) || !filled(rule.anchorName)) bad("the anchor needs its key and name");
  if (!isIsoDate(rule.consultedOn)) bad("consultedOn must be an ISO date");

  const milestones = Array.isArray(rule.milestones) ? rule.milestones : [];
  const kinds = milestones.map((milestone) => milestone.kind).join(",");
  if (rule.kind === "window") {
    if (kinds !== "opens,closes") bad("a window needs exactly an opens and a closes milestone");
  } else if (rule.kind === "deadline" || rule.kind === "expiry") {
    if (kinds !== "due") bad("a deadline or an expiry needs exactly one due milestone");
  } else bad("kind must be deadline, window or expiry");
  for (const milestone of milestones) {
    if (!Array.isArray(milestone.ops)) bad(`milestone ${milestone.kind} needs a list of operations`);
    else for (const op of milestone.ops) { const problem = opProblems(op); if (problem) bad(`milestone ${milestone.kind}: ${problem}`); }
  }
  if (rule.firstCycle) {
    if (!filled(rule.firstCycle.from)) bad("firstCycle.from is required");
    if (!Array.isArray(rule.firstCycle.ops) || rule.firstCycle.ops.length === 0) bad("firstCycle needs operations");
    else for (const op of rule.firstCycle.ops) { const problem = opProblems(op); if (problem) bad(`firstCycle: ${problem}`); }
  }
  const business = milestones.some((milestone) => Array.isArray(milestone.ops) && milestone.ops.some((op) => op && isBusinessOp(op)));
  if (business && !rule.requiresBusinessDays) bad("it counts business days, so requiresBusinessDays must be true");

  const verification = rule.verification;
  if (verification?.status === "verified") {
    if (!Array.isArray(rule.citations) || rule.citations.length === 0) bad("a verified rule needs at least one citation");
    for (const [index, citation] of (rule.citations ?? []).entries()) {
      const at = `citation ${index + 1}`;
      if (!filled(citation.law) || !filled(citation.location)) bad(`${at} needs its law and location`);
      if (!filled(citation.text)) bad(`${at} needs its literal quote`);
      if (!filled(citation.url) || !/^https:\/\/[^\s/]+\.[^\s/]+/.test(citation.url)) bad(`${at} needs an https url`);
      if (!filled(citation.lastReform) || !citation.lastReform.startsWith("DOF ")) bad(`${at} needs lastReform (DOF dd-mm-yyyy)`);
    }
    if (!filled(verification.verifiedBy)) bad("a verified rule needs verifiedBy");
    if (!isIsoDate(verification.verifiedOn)) bad("a verified rule needs verifiedOn as an ISO date");
  } else if (verification?.status !== "unverified") bad("verification.status must be verified or unverified");
  return problems;
}

/** What is wrong with a whole catalog: each rule, and (code, version) used twice. */
export function catalogProblems(rules: readonly ObligationRuleDef[]): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const rule of rules) {
    problems.push(...ruleProblems(rule));
    const key = ruleKey(rule);
    if (seen.has(key)) problems.push(`${key}: listed twice`);
    seen.add(key);
  }
  return problems;
}

/** Verified AND sound: the only rules that can be turned on or produce items. */
export const isUsable = (rule: ObligationRuleDef): boolean =>
  rule.verification.status === "verified" && ruleProblems(rule).length === 0;

export const findRule = (rules: readonly ObligationRuleDef[], key: string): ObligationRuleDef | null => {
  const parts = parseRuleKey(key);
  return parts ? (rules.find((rule) => rule.code === parts.code && rule.version === parts.version) ?? null) : null;
};
