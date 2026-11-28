/**
 * The one way a size in bytes is written for people: whole bytes below 1 KB,
 * then one decimal in KB, MB, GB or TB (steps of 1024, as the documents lists
 * have always shown). Pass the intl formatter (`useFormatter()`) to write the
 * number in the person's locale; without one the number is written with a
 * point, as before.
 */
const UNITS = ["KB", "MB", "GB", "TB"] as const;

/** The part of next-intl's `useFormatter()` this needs. */
export type BytesNumberFormat = {
    number(
        value: number,
        options?: { useGrouping?: false; minimumFractionDigits?: number; maximumFractionDigits?: number },
    ): string;
};

export function formatBytes(bytes: number, format?: BytesNumberFormat): string {
    if (bytes < 1024) {
        return `${format ? format.number(bytes, { useGrouping: false }) : bytes} B`;
    }
    let unit = 0;
    let value = bytes / 1024;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const written = format
        ? format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })
        : value.toFixed(1);
    return `${written} ${UNITS[unit]}`;
}
