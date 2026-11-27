// The daily number of citation checks one person may cause (docs/citation-support-check.md).
//
// Kept in memory, per process: person id -> checks taken on the current day.
// Nothing is written anywhere and the table of results stays free of people.
// The day is the calendar day in Mexico City, the same rule the product's other
// daily numbers use (written out here because lib/ never imports from modules/).
// Entries of earlier days are dropped when the day changes, so the map holds at
// most one entry per person who was checked today.
import { reportError } from "../observability/report";
import { AppError } from "../appError";
import { envInt } from "../runtimeConfig";

export const DEFAULT_DAILY_MAX_PER_PERSON = 2_000;
const CEILING = 1_000_000;

/** The setting, read when used: an unset, empty, zero, negative or non-numeric value is the default; a larger one than the ceiling is the ceiling. */
export function dailyMaxPerPerson(env: NodeJS.ProcessEnv = process.env): number {
    return Math.min(envInt("LITT_CITATION_CHECK_DAILY_MAX_PER_PERSON", DEFAULT_DAILY_MAX_PER_PERSON, env), CEILING);
}

/** The calendar day in Mexico City, as YYYY-MM-DD. */
function mexicoCityDay(now: Date): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}

let day = "";
let taken = new Map<string, number>();
let warnedDay = "";

/**
 * Take up to `wanted` checks from the person's remaining number for today and
 * return how many were granted (0 when nothing remains). Synchronous, so two
 * answers of one person never take the same checks. The first time anyone is
 * given fewer than they wanted on a day, one warning without any person is
 * reported.
 */
export function takeCitationChecks(personId: string, wanted: number, now: Date = new Date()): number {
    const today = mexicoCityDay(now);
    if (today !== day) {
        day = today;
        taken = new Map();
    }
    const used = taken.get(personId) ?? 0;
    const granted = Math.max(0, Math.min(wanted, dailyMaxPerPerson() - used));
    if (granted > 0) taken.set(personId, used + granted);
    if (granted < wanted && warnedDay !== today) {
        warnedDay = today;
        reportError(
            new AppError("citation_support.daily_number_reached", "A person reached the daily number of citation checks"),
            { level: "warning", tags: { component: "citation-support" } },
        );
    }
    return granted;
}

/** People counted for the current day (for tests). */
export function citationCheckCounterSize(): number {
    return taken.size;
}

/** Forget every count and the warning (for tests). */
export function resetCitationCheckCounter(): void {
    day = "";
    taken = new Map();
    warnedDay = "";
}
