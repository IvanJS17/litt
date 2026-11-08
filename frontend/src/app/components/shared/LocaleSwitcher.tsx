"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Languages } from "lucide-react";
import { isLocale, LOCALES, type Locale } from "@litt/i18n";
import { setLocale } from "@/app/lib/localeActions";
import { cn } from "@/app/lib/utils";

/**
 * Each language is named in its own language, so a reader who cannot read the
 * current one can still find theirs.
 */
function languageNameKey(locale: Locale) {
    return locale === "es-MX" ? "common.language.spanish" : "common.language.english";
}

/**
 * Picks the interface language (es-MX or en-US) without a session: it sets the
 * LITT_LOCALE cookie through a server action and refreshes the route, so the
 * server re-renders in the new language and client state, such as what is
 * typed in a form, is kept. A native <select> gives the keyboard, screen-reader
 * and mobile behavior for free; the chosen language is its selected option,
 * not a color.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
    const t = useTranslations();
    const router = useRouter();
    const current = useLocale();
    const [pending, startTransition] = useTransition();
    // Shown at once; the server catches up on the refresh.
    const [chosen, setChosen] = useState<string | null>(null);
    const value = chosen ?? current;

    function change(next: string) {
        if (!isLocale(next) || next === current) return;
        setChosen(next);
        startTransition(async () => {
            const saved = await setLocale(next);
            if (saved) router.refresh();
            else setChosen(null);
        });
    }

    return (
        <div className={cn("relative inline-flex items-center", className)}>
            <Languages
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-gray-500"
            />
            <select
                aria-label={t("common.language.label")}
                aria-busy={pending}
                value={value}
                onChange={(event) => change(event.target.value)}
                className="h-8 [@media(max-height:700px)]:h-6 cursor-pointer appearance-none rounded-lg bg-transparent py-0 pl-8 pr-3 text-xs text-gray-700 outline-none transition-colors hover:bg-app-surface focus-visible:ring-2 focus-visible:ring-focus"
            >
                {LOCALES.map((locale) => (
                    <option key={locale} value={locale} lang={locale}>
                        {t(languageNameKey(locale))}
                    </option>
                ))}
            </select>
        </div>
    );
}
