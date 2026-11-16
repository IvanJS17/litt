"use client";

import { useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { isLocale, LOCALES, type Locale } from "@litt/i18n";
import { setLocale } from "@/app/lib/localeActions";
import { notifyError } from "@/app/lib/userFacingError";
import { LANDING_FOCUS } from "./landingStyles";

/**
 * The language of the page: Español / English, a `radiogroup` that moves with
 * the arrow keys, like the theme control beside it. It sets the same cookie as
 * the language selector of the sign-in screens (`setLocale`) and refreshes, so
 * the server draws the page again in the new language and the examples keep
 * what you had selected.
 */
export function LandingLanguage() {
    const t = useTranslations();
    const router = useRouter();
    const current = useLocale();
    const [pending, startTransition] = useTransition();
    // Shown at once; the server catches up on the refresh.
    const [chosen, setChosen] = useState<string | null>(null);
    const value = chosen ?? current;
    const buttons = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});

    function change(next: Locale) {
        if (next === current) return;
        setChosen(next);
        startTransition(async () => {
            try {
                if (await setLocale(next)) {
                    router.refresh();
                    return;
                }
            } catch (error) {
                notifyError(error, { onRetry: () => change(next) });
            }
            setChosen(null);
        });
    }

    function onKeyDown(event: React.KeyboardEvent) {
        const at = LOCALES.findIndex((locale) => locale === value);
        const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
        if (!step) return;
        event.preventDefault();
        const next = LOCALES[(at + step + LOCALES.length) % LOCALES.length];
        change(next);
        buttons.current[next]?.focus();
    }

    return (
        <div
            role="radiogroup"
            aria-label={t("common.language.label")}
            aria-busy={pending}
            onKeyDown={onKeyDown}
            className="inline-flex gap-1 rounded-full p-[3px] ring-1 ring-inset ring-foreground/14"
        >
            {LOCALES.map((locale) => {
                const selected = locale === value;
                return (
                    <button
                        key={locale}
                        ref={(node) => {
                            buttons.current[locale] = node;
                        }}
                        type="button"
                        role="radio"
                        lang={locale}
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => isLocale(locale) && change(locale)}
                        className={`min-h-11 rounded-full px-3.5 text-[0.9375rem] leading-none select-none transition-colors duration-150 ${LANDING_FOCUS} ${
                            selected
                                ? "bg-interactive-soft-strong text-foreground"
                                : "text-muted-foreground pointer-fine:hover:text-foreground"
                        }`}
                    >
                        {locale === "es-MX" ? t("common.language.spanish") : t("common.language.english")}
                    </button>
                );
            })}
        </div>
    );
}
