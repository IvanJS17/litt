/**
 * Pure date arithmetic of the deadline radar. Every date the radar shows is
 * computed here, in code, in CALENDAR days over ISO dates (YYYY-MM-DD); a model
 * never produces one and business days ("hábiles") are never counted (the
 * item is left for a lawyer to review instead).
 *
 * Dates are plain calendar days, not instants, so the arithmetic runs on UTC
 * midnights and does not depend on the server's zone or on daylight saving.
 * Only "what day is it today" needs a zone: America/Mexico_City.
 *
 * Months are not computed: a fact stores a number of days, never months, so
 * "Jan 31 + 1 month" cannot arise. A notice period written in months must be
 * entered by the lawyer as days (or as the rule's text, which computes
 * nothing).
 */

export const RADAR_TIME_ZONE = "America/Mexico_City";
/** Items due from today up to this many days ahead are "next" ones. */
export const NEXT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const MIN_YEAR = 1000;
const MAX_YEAR = 9999;

export type RadarBucket = "overdue" | "next_30" | "later" | "review";

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const utcDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * `iso` moved by a whole number of calendar days (negative goes back), or null
 * when the input is not a date or the result leaves the years 1000 to 9999.
 */
export function addDays(iso: string, days: number): string | null {
  if (!isIsoDate(iso) || !Number.isSafeInteger(days)) return null;
  const moved = new Date(utcDay(iso) + days * DAY_MS);
  const year = moved.getUTCFullYear();
  if (Number.isNaN(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  return moved.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

/** The calendar date `now` falls on in America/Mexico_City. */
export function todayInMexicoCity(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RADAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Where a dated item sits relative to today; a day without a date is "review". */
export function bucketOf(dueOn: string | null, today: string): RadarBucket {
  if (dueOn === null) return "review";
  const left = daysBetween(today, dueOn);
  if (left < 0) return "overdue";
  return left <= NEXT_WINDOW_DAYS ? "next_30" : "later";
}
