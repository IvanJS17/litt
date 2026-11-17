import type { RetainerReportDays } from "@mike/contracts";

/** The lengths a report can have, in calendar days. */
export const REPORT_DAYS: readonly RetainerReportDays[] = [30, 60, 90];
export const DEFAULT_REPORT_DAYS: RetainerReportDays = 90;
export const NOTE_MAX = 500;

export function isReportDays(value: unknown): value is RetainerReportDays {
  return typeof value === "number" && (REPORT_DAYS as readonly number[]).includes(value);
}
