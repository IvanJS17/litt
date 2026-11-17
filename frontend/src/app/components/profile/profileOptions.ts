import type { ProfileFact, ProfileFactData, ProfileFactKind } from "@mike/contracts";
import { providerLabel, type ModelProvider } from "@/app/lib/modelAvailability";

export const FACT_KINDS: readonly ProfileFactKind[] = ["contract", "date", "power_of_attorney", "obligation", "other"];
export const DATE_KINDS = ["effective", "expiry", "renewal_notice"] as const;
export const DAY_TYPES = ["calendar", "business"] as const;

export const LABEL_MAX = 160;
export const QUOTE_MAX = 2000;
export const REASON_MAX = 500;

/** What the form collects for a fact, as the text the lawyer typed. */
export type FactDraft = Record<string, string>;

export type FieldSpec = { key: string; kind: "text" | "area" | "date" | "number"; required?: boolean; max?: number };

/** The fields of each kind of fact, in the order the form shows them. */
export const FIELDS: Record<Exclude<ProfileFactKind, "date">, FieldSpec[]> = {
  contract: [
    { key: "counterparty", kind: "text", required: true, max: 200 },
    { key: "object", kind: "area", required: true, max: 500 },
  ],
  power_of_attorney: [
    { key: "grantee", kind: "text", required: true, max: 200 },
    { key: "scope", kind: "area", required: true, max: 1000 },
    { key: "granted_on", kind: "date" },
    { key: "expires_on", kind: "date" },
  ],
  obligation: [
    { key: "description", kind: "area", required: true, max: 1000 },
    { key: "periodicity", kind: "text", max: 120 },
  ],
  other: [{ key: "note", kind: "area", required: true, max: 1000 }],
};

export type FieldWord =
  | "counterparty"
  | "object"
  | "grantee"
  | "scope"
  | "grantedOn"
  | "expiresOn"
  | "description"
  | "periodicity"
  | "note";

const FIELD_WORDS: Record<string, FieldWord> = {
  counterparty: "counterparty",
  object: "object",
  grantee: "grantee",
  scope: "scope",
  granted_on: "grantedOn",
  expires_on: "expiresOn",
  description: "description",
  periodicity: "periodicity",
  note: "note",
};

/** The catalog name of a field key (`clientProfile.fields.<word>`). */
export const fieldWord = (key: string): FieldWord => FIELD_WORDS[key];

/** What the server can refuse about a citation, as `clientProfile.form.<key>`. */
export type FormErrorKey = "quoteNotFound" | "sourceTextUnavailable" | "versionNotInMatter";

/** A date fact needs a date, the rule as worded, or a notice period. */
export function isDraftReady(kind: ProfileFactKind, draft: FactDraft, label: string): boolean {
  if (label.trim() === "") return false;
  const filled = (key: string) => (draft[key] ?? "").trim() !== "";
  if (kind === "date") return filled("date_on") || filled("rule_text") || filled("notice_days");
  return FIELDS[kind].every((field) => !field.required || filled(field.key));
}

/** The `data` the server expects, from what was typed: blanks left out, days as a number. */
export function dataOf(kind: ProfileFactKind, draft: FactDraft): ProfileFactData {
  const data: Record<string, string | number> = {};
  const keys =
    kind === "date"
      ? ["date_kind", "date_on", "rule_text", "notice_days", "notice_day_type"]
      : FIELDS[kind].map((field) => field.key);
  for (const key of keys) {
    const value = (draft[key] ?? "").trim();
    if (value === "") continue;
    data[key] = key === "notice_days" ? Number(value) : value;
  }
  if (kind === "date" && data.notice_days === undefined) delete data.notice_day_type;
  return data as ProfileFactData;
}

/** The facts of a kind, newest first as the server sent them. */
export function groupFacts(facts: readonly ProfileFact[]): [ProfileFactKind, ProfileFact[]][] {
  return FACT_KINDS.map((kind): [ProfileFactKind, ProfileFact[]] => [kind, facts.filter((fact) => fact.kind === kind)]).filter(
    ([, group]) => group.length > 0,
  );
}

/** The mark the server puts on the creation event of a fact the AI proposed. */
export const ASSISTED_EXTRACTION_REASON = "assisted_extraction";

/** The provider's name for the helper line; a provider the catalog does not name is shown as the server called it. */
export function extractionProviderName(provider: string): string {
  try {
    return providerLabel(provider as ModelProvider);
  } catch {
    return provider;
  }
}

/** The facts a run proposed that still wait for a decision, in the order saved. */
export function pendingProposals(facts: readonly ProfileFact[], proposedIds: readonly string[]): ProfileFact[] {
  const order = new Map(proposedIds.map((id, index) => [id, index] as const));
  return facts
    .filter((fact) => order.has(fact.id) && fact.status === "pending")
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
