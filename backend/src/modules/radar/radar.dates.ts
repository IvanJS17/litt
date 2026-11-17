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
 * Facts store days, never months, so the fact-derived items only add days.
 * The obligation rules (radar.rules.ts) can also count calendar MONTHS and
 * YEARS from a date. Those use one explicit end-of-month rule (addMonths):
 * the day of the month is kept when the target month has it and otherwise
 * clamped to the last day of that month (Jan 31 + 1 month = Feb 28, or Feb 29
 * in a leap year; Feb 29 + 1 year = Feb 28). Business days are never counted.
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

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * `iso` moved by a whole number of calendar months (negative goes back). The
 * end-of-month rule: when the target month is shorter than the day of the
 * month, the result is that month's last day (Jan 31 + 1 month = Feb 28/29;
 * Mar 31 - 1 month = Feb 28/29; Aug 31 + 1 month = Sep 30). Null when the input
 * is not a date or the result leaves the years 1000 to 9999.
 */
export function addMonths(iso: string, months: number): string | null {
  if (!isIsoDate(iso) || !Number.isSafeInteger(months)) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  if (targetYear < MIN_YEAR || targetYear > MAX_YEAR) return null;
  const targetMonth = (index - targetYear * 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(targetYear, 4)}-${pad(targetMonth, 2)}-${pad(targetDay, 2)}`;
}

/** `iso` moved by whole calendar years: twelve months each, same end-of-month rule. */
export function addYears(iso: string, years: number): string | null {
  return Number.isSafeInteger(years) ? addMonths(iso, years * 12) : null;
}

export type CalendarUnit = "days" | "months" | "years";

/** `iso` moved by `amount` calendar days, months or years (negative goes back). */
export function addCalendar(iso: string, unit: CalendarUnit, amount: number): string | null {
  if (unit === "days") return addDays(iso, amount);
  if (unit === "months") return addMonths(iso, amount);
  if (unit === "years") return addYears(iso, amount);
  return null;
}

/** The first day of the month `iso` falls in. */
export function startOfMonth(iso: string): string | null {
  return isIsoDate(iso) ? `${iso.slice(0, 8)}01` : null;
}

/** The last day of the month `iso` falls in (28, 29, 30 or 31). */
export function endOfMonth(iso: string): string | null {
  if (!isIsoDate(iso)) return null;
  const last = daysInMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  return `${iso.slice(0, 8)}${String(last).padStart(2, "0")}`;
}
