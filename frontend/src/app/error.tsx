"use client";

import Link from "next/link";
import { pillButtonUIClassName } from "@mike/ui";
import { CrashScreen } from "@/app/components/shared/CrashScreen";
import { useTranslations } from "next-intl";

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset?: () => void;
}) {
    const t = useTranslations();
    return (
        <CrashScreen
            error={error}
            reset={reset}
            component="route-error-boundary"
            secondaryAction={(tone) => (
                <Link
                    href="/"
                    className={pillButtonUIClassName({ tone, size: "normal" })}
                >
                    {t("errors.page.home")}
                </Link>
            )}
        />
    );
}
