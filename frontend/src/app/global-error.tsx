"use client";

// global-error replaces the root layout, so it imports the layout's CSS
// itself; without these the design-system classes below would not apply.
import "./fonts/fonts.css";
import "./globals.css";
import { CrashScreen } from "@/app/components/shared/CrashScreen";
import { PillButtonUI } from "@mike/ui";
import { clientLocale, clientTranslator } from "@mike/client";
import type { AppTranslate } from "@/i18n/Translate";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset?: () => void;
}) {
    // No provider here: this replaces the root layout. The client translator
    // still speaks the language the app last configured (en-US if it never did).
    const t = clientTranslator() as unknown as AppTranslate;
    return (
        <html lang={clientLocale()}>
            <head>
                <title>{t("shared.crashScreen.documentTitle")}</title>
            </head>
            <body className="font-sans antialiased">
                <CrashScreen
                    error={error}
                    reset={reset}
                    component="global-error-boundary"
                    t={t}
                    // Back, not Home: the root layout itself failed, so a
                    // client-side link home would render it again.
                    secondaryAction={(tone) => (
                        <PillButtonUI
                            type="button"
                            tone={tone}
                            size="normal"
                            onClick={() => window.history.back()}
                        >
                            {t("shared.crashScreen.back")}
                        </PillButtonUI>
                    )}
                />
            </body>
        </html>
    );
}
