import { useEffect } from "react";
import { describeError, supportMailtoFor } from "@/app/lib/userFacingError";

type CrashError = Error & { digest?: string };

/**
 * The shared half of `app/error.tsx` and `app/global-error.tsx`.
 *
 * Logs the crash once for the local console (a re-render or "Try again" must
 * not repeat it) and returns the "Contact support" email. The render crashed,
 * so nothing on the screen may echo `error.message`; the digest is the only
 * detail worth handing over, and it travels in the email.
 */
export function useCrashBoundary(
    error: CrashError,
    { component }: { component: string },
): string {
    useEffect(() => {
        console.error(`[${component}]`, error);
    }, [component, error]);

    return supportMailtoFor(
        describeError(error, { action: "load this page" }),
        `Error reference: ${error.digest ?? "unavailable"}`,
    );
}
