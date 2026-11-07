// Typed keys and locales for next-intl (next-intl docs, "workflows/typescript"):
// t("common.save") is checked against the en-US source catalog.
// Kept apart from src/global.d.ts, which must stay a script for its wildcard
// module declarations; an augmentation needs a module (this file's import).
import type { Locale, Messages } from "@litt/i18n";

declare module "next-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: Messages;
    }
}
