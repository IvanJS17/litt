"use client";

import { useEffect, useState } from "react";
import { getAuthProviders } from "@/app/lib/authApi";

type Shown = { showSso: boolean; showGoogle: boolean };

const PENDING: Shown = { showSso: false, showGoogle: false };
const UNKNOWN: Shown = { showSso: true, showGoogle: true };

/**
 * Which optional sign-in routes to offer. Nothing is drawn until the server
 * answers, so a route that is off never flashes in and out on load. Once it
 * answers, a route is hidden only if the server says it is off (`false`);
 * `true`, `null` (the server can't tell) or a failed read keep the button,
 * because hiding a sign-in route that may well work is worse than one that
 * answers "not enabled".
 */
export function useAuthProviders(): Shown {
    const [shown, setShown] = useState<Shown>(PENDING);
    useEffect(() => {
        let cancelled = false;
        getAuthProviders().then(
            (providers) => {
                if (cancelled) return;
                setShown({
                    showSso: providers?.sso !== false,
                    showGoogle: providers?.google !== false,
                });
            },
            () => {
                if (!cancelled) setShown(UNKNOWN);
            },
        );
        return () => {
            cancelled = true;
        };
    }, []);
    return shown;
}
