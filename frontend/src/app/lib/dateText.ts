import type { useFormatter } from "next-intl";

/**
 * The provider's date formatter. It already carries the interface language
 * and the `America/Mexico_City` time zone, so a helper that shows a date
 * takes this instead of calling `toLocaleString` with whatever the browser
 * has.
 */
export type DateFormatter = ReturnType<typeof useFormatter>;

/** Shown in place of a timestamp that is missing or malformed. */
export const NO_DATE = "—";

function validDate(value: string | Date): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "12 nov 2026, 3:04 p.m." */
export function formatShortDateTime(format: DateFormatter, iso: string | Date): string {
    const date = validDate(iso);
    if (!date) return NO_DATE;
    return format.dateTime(date, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/** "12 nov 2026" */
export function formatShortDate(format: DateFormatter, iso: string | Date): string {
    const date = validDate(iso);
    return date ? format.dateTime(date, { day: "numeric", month: "short", year: "numeric" }) : NO_DATE;
}

/** Numeric date and time, for dense lists. */
export function formatNumericDateTime(format: DateFormatter, iso: string | Date): string {
    const date = validDate(iso);
    return date ? format.dateTime(date, { dateStyle: "short", timeStyle: "medium" }) : NO_DATE;
}
