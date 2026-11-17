"use client";

import { useTranslations } from "next-intl";
import type { ObligationRuleMilestone, ObligationRuleOp } from "@mike/contracts";

/** The words of an obligation rule: its name, how each date is counted, where it comes from. */
export function useObligationWords() {
  const t = useTranslations();
  // A rule's name, "applies when" and anchor sentences are keys the catalog names at
  // run time (radar.rules.catalog.<code>), so they cannot be typed literals.
  const loose = t as unknown as ((key: string) => string) & { has: (key: string) => boolean };
  const ruleName = (key: string, fallback: string) => (loose.has(key) ? loose(key) : fallback);
  const opText = (op: ObligationRuleOp): string => {
    if ("adjust" in op) return t(op.adjust === "month_start" ? "radar.rules.op.month_start" : "radar.rules.op.month_end");
    const count = Math.abs(op.amount);
    const direction = op.amount < 0 ? "before" : "after";
    switch (op.unit) {
      case "days":
        return t("radar.rules.op.days", { count, direction });
      case "months":
        return t("radar.rules.op.months", { count, direction });
      case "years":
        return t("radar.rules.op.years", { count, direction });
      default:
        return t("radar.rules.op.business_days", { count });
    }
  };
  const stepsText = (ops: readonly ObligationRuleOp[]): string =>
    ops.length === 0 ? t("radar.rules.op.none") : ops.map(opText).join(`, ${t("radar.rules.op.then")} `);
  const milestoneText = (milestone: ObligationRuleMilestone): string =>
    t("radar.rules.op.line", { milestone: t(`radar.rules.milestone.${milestone.kind}`), steps: stepsText(milestone.ops) });
  const firstCycleFrom = (name: string): string => {
    const key = `radar.rules.firstCycleFrom.${name}`;
    return loose.has(key) ? loose(key) : name;
  };
  return { ruleName, opText, stepsText, milestoneText, firstCycleFrom };
}
