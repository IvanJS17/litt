"use client";

// global-error replaces the root layout, so it imports the layout's CSS
// itself; without these the design-system classes below would not apply.
import "./fonts/fonts.css";
import "./globals.css";
import { CrashScreen } from "@/app/components/shared/CrashScreen";
import { PillButtonUI } from "@mike/ui";
import { useTranslations } from "next-intl";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset?: () => void;
}) {
    const t = useTranslations();
    return (
        <html lang="en">
            <head>
                <title>{t("errors.page.somethingWentWrongLitt")}</title>
            </head>
            <body className="font-sans antialiased">
                <CrashScreen
                    error={error}
                    reset={reset}
                    component="global-error-boundary"
                    // Back, not Home: the root layout itself failed, so a
                    // client-side link home would render it again.
                    secondaryAction={(tone) => (
                        <PillButtonUI
                            type="button"
                            tone={tone}
                            size="normal"
                            onClick={() => window.history.back()}
                        >
                            {t("errors.page.back")}
                        </PillButtonUI>
                    )}
                />
            </body>
        </html>
    );
}
