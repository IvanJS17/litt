/**
 * Vocabulary, input parsing and row mapping of the client-profile module (the
 * living profile of a retainer client: docs/client-profile.md).
 *
 * A fact is one datum a lawyer captured by hand, with the passage of a matter
 * document that backs it. Nothing here asks a model for anything and nothing
 * here computes a deadline: dates are stored as entered, and the notice period
 * is a number the next layer reads.
 */

import type {
  ProfileFact,
  ProfileFactData,
  ProfileFactEvent,
  ProfileFactKind,
  ProfileFactStaleReason,
  ProfileFactStatus,
} from "@mike/contracts";
import { isUuid } from "../../lib/uuid";

export const FACT_KINDS: readonly ProfileFactKind[] = [
  "contract",
  "date",
  "power_of_attorney",
  "obligation",
  "other",
];
export const DATE_KINDS = ["effective", "expiry", "renewal_notice"] as const;
export const NOTICE_DAY_TYPES = ["calendar", "business"] as const;

export const LABEL_MAX = 160;
export const QUOTE_MAX = 2000;
export const REASON_MAX = 500;
export const NOTICE_DAYS_MAX = 3650;
export const MAX_FACTS_PER_MATTER = 1000;
export const MAX_SOURCE_VERSIONS = 300;

export const NOT_A_RETAINER_CODE = "matter_not_retainer";
export const INVALID_FACT_CODE = "invalid_profile_fact";
export const CITATION_REQUIRED_CODE = "citation_required";
export const VERSION_NOT_IN_MATTER_CODE = "version_not_in_matter";
export const SOURCE_TEXT_UNAVAILABLE_CODE = "source_text_unavailable";
export const QUOTE_NOT_FOUND_CODE = "quote_not_found";
export const FACT_ALREADY_DECIDED_CODE = "fact_already_decided";
export const FACT_STALE_CODE = "fact_stale";
export const FACT_LIMIT_CODE = "profile_fact_limit";

export type Parsed<T> = { ok: true; value: T } | { ok: false; detail: string; code: string };

const invalid = (detail: string): { ok: false; detail: string; code: string } => ({
  ok: false,
  detail,
  code: INVALID_FACT_CODE,
});

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Trimmed text of 1..max characters (code points), or null. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const length = [...text].length;
  return length >= 1 && length <= max ? text : null;
}

type Field = { key: keyof ProfileFactData; type: "text" | "date"; max?: number; required?: boolean };

const TEXT_FIELDS: Record<Exclude<ProfileFactKind, "date">, Field[]> = {
  contract: [
    { key: "counterparty", type: "text", max: 200, required: true },
    { key: "object", type: "text", max: 500, required: true },
  ],
  power_of_attorney: [
    { key: "grantee", type: "text", max: 200, required: true },
    { key: "scope", type: "text", max: 1000, required: true },
    { key: "granted_on", type: "date" },
    { key: "expires_on", type: "date" },
  ],
  obligation: [
    { key: "description", type: "text", max: 1000, required: true },
    { key: "periodicity", type: "text", max: 120 },
  ],
  other: [{ key: "note", type: "text", max: 1000, required: true }],
};

function parseFields(kind: Exclude<ProfileFactKind, "date">, data: Record<string, unknown>): Parsed<ProfileFactData> {
  const fields = TEXT_FIELDS[kind];
  const allowed = new Set<string>(fields.map((field) => field.key));
  for (const key of Object.keys(data)) if (!allowed.has(key)) return invalid(`${key} is not a field of a ${kind} fact.`);
  const out: Record<string, string> = {};
  for (const field of fields) {
    const raw = data[field.key];
    if (raw == null || raw === "") {
      if (field.required) return invalid(`${field.key} is required.`);
      continue;
    }
    if (field.type === "date") {
      if (!isIsoDate(raw)) return invalid(`${field.key} must be a date (YYYY-MM-DD).`);
      out[field.key] = raw;
    } else {
      const text = cleanText(raw, field.max!);
      if (!text) return invalid(`${field.key} must be 1 to ${field.max} characters.`);
      out[field.key] = text;
    }
  }
  if (out.granted_on && out.expires_on && out.expires_on < out.granted_on)
    return invalid("expires_on cannot be before granted_on.");
  return { ok: true, value: out as ProfileFactData };
}

const DATE_KEYS = new Set(["date_kind", "date_on", "rule_text", "notice_days", "notice_day_type"]);

function parseDate(data: Record<string, unknown>): Parsed<ProfileFactData> {
  for (const key of Object.keys(data)) if (!DATE_KEYS.has(key)) return invalid(`${key} is not a field of a date fact.`);
  if (!(DATE_KINDS as readonly unknown[]).includes(data.date_kind))
    return invalid("date_kind must be effective, expiry or renewal_notice.");
  const out: ProfileFactData = { date_kind: data.date_kind as ProfileFactData["date_kind"] };
  if (data.date_on != null && data.date_on !== "") {
    if (!isIsoDate(data.date_on)) return invalid("date_on must be a date (YYYY-MM-DD).");
    out.date_on = data.date_on;
  }
  if (data.rule_text != null && data.rule_text !== "") {
    const text = cleanText(data.rule_text, 300);
    if (!text) return invalid("rule_text must be 1 to 300 characters.");
    out.rule_text = text;
  }
  if (data.notice_days != null) {
    const days = data.notice_days;
    if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 0 || days > NOTICE_DAYS_MAX)
      return invalid(`notice_days must be a whole number from 0 to ${NOTICE_DAYS_MAX}.`);
    out.notice_days = days;
    const type = data.notice_day_type ?? "calendar";
    if (!(NOTICE_DAY_TYPES as readonly unknown[]).includes(type))
      return invalid("notice_day_type must be calendar or business.");
    out.notice_day_type = type as ProfileFactData["notice_day_type"];
  } else if (data.notice_day_type != null) {
    return invalid("notice_day_type needs notice_days.");
  }
  if (!out.date_on && !out.rule_text && out.notice_days === undefined)
    return invalid("A date fact needs a date, a rule as the document words it, or a notice period.");
  return { ok: true, value: out };
}

export type ParsedFact = {
  kind: ProfileFactKind;
  label: string;
  data: ProfileFactData;
  versionId: string;
  quote: string;
};

export function parseFact(body: unknown): Parsed<ParsedFact> {
  if (!isRecord(body)) return invalid("A request body is required.");
  if (typeof body.kind !== "string" || !(FACT_KINDS as readonly string[]).includes(body.kind))
    return invalid("kind must be contract, date, power_of_attorney, obligation or other.");
  const kind = body.kind as ProfileFactKind;
  // No citation, no fact: the 400 that says so comes before any field check.
  const source = body.source;
  const versionId = isRecord(source) && typeof source.version_id === "string" && isUuid(source.version_id) ? source.version_id : null;
  const quote = isRecord(source) && typeof source.quote === "string" && source.quote.trim() ? source.quote : null;
  if (!versionId || !quote)
    return {
      ok: false,
      code: CITATION_REQUIRED_CODE,
      detail: "A fact needs a citation: the document version and the passage that backs it.",
    };
  if ([...quote].length > QUOTE_MAX) return invalid(`The quote is at most ${QUOTE_MAX} characters.`);
  const label = cleanText(body.label, LABEL_MAX);
  if (!label) return invalid(`label is required (1 to ${LABEL_MAX} characters).`);
  if (!isRecord(body.data)) return invalid("data must be an object.");
  const data = kind === "date" ? parseDate(body.data) : parseFields(kind, body.data);
  if (!data.ok) return data;
  return { ok: true, value: { kind, label, data: data.value, versionId, quote } };
}

export type FactRow = {
  id: string;
  matter_id: string;
  kind: ProfileFactKind;
  label: string;
  data: ProfileFactData | null;
  document_id: string;
  version_id: string;
  start_char: number;
  end_char: number;
  quote: string;
  text_sha256: string;
  created_by: string | null;
  created_at: string;
};
export const FACT_COLUMNS =
  "id, matter_id, kind, label, data, document_id, version_id, start_char, end_char, quote, text_sha256, created_by, created_at";

export type EventRow = {
  id: string;
  fact_id: string;
  actor_user_id: string | null;
  action: ProfileFactEvent["action"];
  text_sha256: string | null;
  reason: string | null;
  created_at: string;
};
export const EVENT_COLUMNS = "id, fact_id, actor_user_id, action, text_sha256, reason, created_at";

/**
 * The state of a fact from its events. A fact moves one way (created, then
 * confirmed or rejected, and a confirmed one may still be rejected), so the
 * set of actions says it, whatever the order of equal timestamps.
 */
export function statusOf(events: readonly Pick<EventRow, "action">[]): ProfileFactStatus {
  if (events.some((event) => event.action === "rejected")) return "rejected";
  if (events.some((event) => event.action === "confirmed")) return "confirmed";
  return "pending";
}

export type SourceState = {
  versionNumber: number | null;
  filename: string | null;
  staleReason: ProfileFactStaleReason | null;
  /** The SHA-256 of the cited version's text now; null when it cannot be read. */
  currentSha: string | null;
};

export function toFact(row: FactRow, events: readonly EventRow[], source: SourceState | undefined): ProfileFact {
  const status = statusOf(events);
  const gone: SourceState = { versionNumber: null, filename: null, staleReason: "version_missing", currentSha: null };
  const state = source ?? gone;
  // A decision closes the question for a rejected fact; the others depend on the source.
  const staleReason = status === "rejected" ? null : state.staleReason;
  const decision = [...events].reverse().find((event) => event.action !== "created");
  return {
    id: row.id,
    matter_id: row.matter_id,
    kind: row.kind,
    label: row.label,
    data: row.data ?? {},
    status,
    stale_reason: staleReason,
    effective_status: staleReason ? "stale" : status,
    source: {
      document_id: row.document_id,
      version_id: row.version_id,
      version_number: state.versionNumber,
      filename: state.filename,
      start_char: row.start_char,
      end_char: row.end_char,
      quote: row.quote,
      text_sha256: row.text_sha256,
    },
    created_by: row.created_by,
    created_at: row.created_at,
    decided_by: decision?.actor_user_id ?? null,
    decided_at: decision?.created_at ?? null,
    events: events.map((event) => ({
      id: event.id,
      actor_user_id: event.actor_user_id,
      action: event.action,
      reason: event.reason,
      created_at: event.created_at,
    })),
  };
}
