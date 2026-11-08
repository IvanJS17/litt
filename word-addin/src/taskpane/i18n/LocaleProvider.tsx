/**
 * The task pane's interface language: one use-intl provider whose locale can
 * change without reloading the pane.
 *
 * The same locale and catalog also reach @mike/client, so failure messages
 * and toast labels made outside React follow it (configureClientLocale).
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { IntlProvider } from "use-intl";
import type { Locale } from "@litt/i18n";
import { storeLocale, TIME_ZONE } from "./locale";
import { loadLocale, type LoadedLocale } from "./loadLocale";

interface LocaleControls {
  locale: Locale;
  /** Switch language now and remember it on this device. */
  setLocale: (locale: Locale) => Promise<void>;
}

const LocaleContext = createContext<LocaleControls | null>(null);

export function useLocaleControls(): LocaleControls {
  const controls = useContext(LocaleContext);
  if (!controls) throw new Error("useLocaleControls needs a LocaleProvider");
  return controls;
}

// A missing key is already filled from en-US by loadMessages; one absent from
// the source too shows its key and is logged where it can be fixed.
function onError(error: { message: string }): void {
  if (process.env.NODE_ENV !== "production") console.warn(error.message);
}

function getMessageFallback({
  namespace,
  key,
}: {
  namespace?: string;
  key: string;
}): string {
  return namespace ? `${namespace}.${key}` : key;
}

export function LocaleProvider({
  initial,
  children,
}: {
  initial: LoadedLocale;
  children: React.ReactNode;
}): React.ReactElement {
  const [loaded, setLoaded] = useState(initial);
  const latest = useRef(initial.locale);

  const setLocale = useCallback(async (next: Locale): Promise<void> => {
    latest.current = next;
    const result = await loadLocale(next);
    // Two quick switches: the last one asked for wins.
    if (latest.current !== next) return;
    storeLocale(next);
    setLoaded(result);
  }, []);

  const controls = useMemo(
    () => ({ locale: loaded.locale, setLocale }),
    [loaded.locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={controls}>
      <IntlProvider
        locale={loaded.locale}
        messages={loaded.messages}
        timeZone={TIME_ZONE}
        onError={onError}
        getMessageFallback={getMessageFallback}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
