/**
 * Vocabulary, period arithmetic and input parsing of the retainer report
 * (docs/retainer-report.md). Pure.
 *
 * The report counts requests, rounds and calendar days. Nothing here, or in
 * the report, measures or estimates time worked.
 */

import type { RetainerReportDays, RetainerReportLocale } from "@mike/contracts";

export const REPORT_TIME_ZONE = "America/Mexico_City";
export const REPORT_DAYS: readonly RetainerReportDays[] = [30, 60, 90];
export const DEFAULT_REPORT_DAYS: RetainerReportDays = 90;
export const REPORT_LOCALES: readonly RetainerReportLocale[] = ["es-MX", "en-US"];
export const DEFAULT_REPORT_LOCALE: RetainerReportLocale = "es-MX";
export const NOTE_MAX = 500;
/** Most dated radar items and confirmed facts the report lists. */
export const MAX_LISTED = 200;
export const MAX_SENT_LISTED = 200;

export const NOT_A_RETAINER_CODE = "matter_not_retainer";
export const INVALID_REPORT_CODE = "invalid_report";

const DAY_MS = 86_400_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The calendar date `now` falls on in America/Mexico_City (YYYY-MM-DD). */
export function todayInMexicoCity(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const utcDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/** `iso` moved by a whole number of calendar days. */
export function addDays(iso: string, days: number): string {
  return new Date(utcDay(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

export type ReportPeriod = {
  days: RetainerReportDays;
  /** First day of the period. */
  start: string;
  /** Last day of the period: today. */
  end: string;
  /** The look-ahead window: today to `days` days after it. */
  horizonStart: string;
  horizonEnd: string;
};

/**
 * The last `days` calendar days ending today, both ends included (90 days:
 * today and the 89 before it), and the `days` days that follow today.
 */
export function periodFor(today: string, days: RetainerReportDays): ReportPeriod {
  return {
    days,
    start: addDays(today, -(days - 1)),
    end: today,
    horizonStart: today,
    horizonEnd: addDays(today, days),
  };
}

export const inRange = (date: string, from: string, to: string): boolean => date >= from && date <= to;

/** `90d` (also 30d, 60d) to its number of days, or null. */
export function parsePeriod(value: unknown): RetainerReportDays | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2})d$/.exec(value);
  const days = match ? Number(match[1]) : NaN;
  return (REPORT_DAYS as readonly number[]).includes(days) ? (days as RetainerReportDays) : null;
}

/** An absent locale is the default; an unknown one is null (a 400). */
export function parseLocale(value: unknown): RetainerReportLocale | null {
  if (value === undefined) return DEFAULT_REPORT_LOCALE;
  return typeof value === "string" && (REPORT_LOCALES as readonly string[]).includes(value)
    ? (value as RetainerReportLocale)
    : null;
}

/** An optional note: trimmed, at most NOTE_MAX characters (code points); empty is none. */
export function parseNote(value: unknown): { ok: true; note: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, note: null };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  if ([...text].length > NOTE_MAX) return { ok: false };
  return { ok: true, note: text || null };
}
