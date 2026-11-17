import { PRACTICE_AREA_OPTIONS, practiceAreaLabel } from "@/app/onboarding/options";
import type { AppTranslate } from "@/i18n/Translate";

export const PRACTICE_OPTIONS = [
    "General Transactions",
    ...PRACTICE_AREA_OPTIONS,
] as const;

export type Practice = (typeof PRACTICE_OPTIONS)[number];

/**
 * The label of a saved project practice in the interface language. The saved
 * value stays the English name; only what is shown is translated. A value
 * outside the list (typed by hand) is shown as saved.
 */
export function projectPracticeLabel(value: string, t: AppTranslate): string {
    if (value === "General Transactions") return t("training.generalTransactions");
    if (value === "Other") return t("settings.personalisationFields.areas.other");
    return practiceAreaLabel(value, t);
}
