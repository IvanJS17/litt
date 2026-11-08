import React from "react";
import { useTranslations } from "use-intl";
import { LOCALES, isLocale, type Locale } from "@litt/i18n";

const selectClassName =
  "w-full rounded-lg border border-transparent bg-gray-100 px-3 py-2 text-sm text-gray-900 focus-visible:border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300/45 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Native language picker. Each language is named in its own language so it
 * can be found whichever one the pane is in.
 */
export function LocaleSelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  value: Locale;
  onChange: (locale: Locale) => void;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <select
      id={id}
      aria-label={t("word.language.label")}
      className={className ? `${selectClassName} ${className}` : selectClassName}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        if (isLocale(next)) onChange(next);
      }}
    >
      {LOCALES.map((locale) => (
        <option key={locale} value={locale} lang={locale}>
          {t(`word.language.names.${locale}`)}
        </option>
      ))}
    </select>
  );
}
