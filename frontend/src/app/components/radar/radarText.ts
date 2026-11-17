"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { RadarItem } from "@mike/contracts";

/** The words of a radar item: its date and how far it is, as plain text. */
export function useRadarWords() {
  const t = useTranslations();
  const format = useFormatter();
  // Dates are calendar days: shown at noon UTC so no zone moves them.
  const day = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const distance = (item: Pick<RadarItem, "days_left">): string | null => {
    if (item.days_left === null) return null;
    if (item.days_left === 0) return t("radar.when.today");
    return item.days_left < 0
      ? t("radar.when.overdueDays", { count: -item.days_left })
      : t("radar.when.inDays", { count: item.days_left });
  };
  return { day, distance };
}
