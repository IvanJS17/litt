// Which language the annex is written in: the person's profile preference
// (user_profiles.ui_locale), es-MX when they have none or it cannot be read.

import { UI_LOCALES, isUiLocale } from "../uiLocale";

export type MethodologyLocale = (typeof UI_LOCALES)[number];
export const DEFAULT_UI_LOCALE: MethodologyLocale = "es-MX";
export { isUiLocale };

type ProfileReader = {
    from: (table: string) => {
        select: (columns: string) => {
            eq: (column: string, value: string) => {
                maybeSingle: () => PromiseLike<{ data: { ui_locale?: unknown } | null; error: unknown }>;
            };
        };
    };
};

/** The annex locale of a person. A failed read (or a database without the column) means the default. */
export async function readAnnexLocale(db: unknown, userId: string): Promise<MethodologyLocale> {
    try {
        const { data, error } = await (db as ProfileReader)
            .from("user_profiles")
            .select("ui_locale")
            .eq("user_id", userId)
            .maybeSingle();
        return !error && isUiLocale(data?.ui_locale) ? data.ui_locale : DEFAULT_UI_LOCALE;
    } catch {
        return DEFAULT_UI_LOCALE;
    }
}
