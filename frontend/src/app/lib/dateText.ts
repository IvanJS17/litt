import type { useFormatter } from "next-intl";

/**
 * The provider's date formatter. It already carries the interface language
 * and the `America/Mexico_City` time zone, so a helper that shows a date
 * takes this instead of calling `toLocaleString` with whatever the browser
 * has.
 */
export type DateFormatter = ReturnType<typeof useFormatter>;

/** "12 nov 2026, 3:04 p.m." */
export function formatShortDateTime(format: DateFormatter, iso: string | Date): string {
    return format.dateTime(new Date(iso), {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

/** Numeric date and time, for dense lists. */
export function formatNumericDateTime(format: DateFormatter, iso: string | Date): string {
    return format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "medium" });
}
