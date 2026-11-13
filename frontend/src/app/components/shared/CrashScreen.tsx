"use client";

import type { ReactNode } from "react";
import { useCrashBoundary } from "@/app/hooks/useCrashBoundary";
import { PillButtonUI, authGlassCardUIClassName, textButtonUIClassName } from "@mike/ui";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import type { AppTranslate } from "@/i18n/Translate";

/**
 * The body of `app/error.tsx` and `app/global-error.tsx`: one markup, so the
 * two crash screens cannot drift apart. Logs the crash once and never
 * shows `error.message` (see useCrashBoundary); the digest is the only
 * detail on screen and in the support email.
 */
export function CrashScreen({
    error,
    reset,
    component,
    secondaryAction,
    t,
}: {
    error: Error & { digest?: string };
    reset?: () => void;
    component: string;
    /** Rendered after "Try again": white when Try again is shown, else black. */
    secondaryAction: (tone: "white" | "black") => ReactNode;
    /**
     * The caller's translator. `global-error` renders with no provider (it
     * replaces the root layout), so the screen cannot read one itself.
     */
    t: AppTranslate;
}) {
    const supportHref = useCrashBoundary(error, { component });

    // The sign-in frame (logo, paper, dvh) so a crash does not look like another
    // site and does not scroll on a phone. No language selector: global-error
    // renders without the provider it needs.
    return (
        <AuthPageShell withLocaleSwitcher={false}>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    <h2 className="font-serif text-2xl font-medium text-gray-950">
                        {t("shared.crashScreen.somethingWentWrong")}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-gray-600">
                        {t("shared.crashScreen.thisPageDidntLoadTryAgain")}
                    </p>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        {reset && (
                            <PillButtonUI
                                type="button"
                                tone="black"
                                size="normal"
                                onClick={() => reset()}
                            >
                                {t("shared.crashScreen.tryAgain")}
                            </PillButtonUI>
                        )}
                        {secondaryAction(reset ? "white" : "black")}
                    </div>

                    <p className="mt-6 text-sm text-gray-500">
                        <a
                            href={supportHref}
                            className={textButtonUIClassName({
                                size: "normal",
                                className:
                                    "px-0 text-gray-600 underline underline-offset-4 hover:text-gray-900",
                            })}
                        >
                            {t("shared.crashScreen.contactSupport")}
                        </a>
                        {error.digest && (
                            <span className="ml-2 text-gray-400">
                                {t("shared.crashScreen.errorReferenceDigest", { digest: error.digest })}
                            </span>
                        )}
                    </p>
                </div>
            </div>
        </AuthPageShell>
    );
}
