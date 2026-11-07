"use client";

import { useEffect, useState } from "react";
import { getAuthProviders } from "@/app/lib/authApi";

/**
 * Which optional sign-in routes to offer. A route is hidden only once the
 * server says it is off: while the answer is on its way, or if it never
 * comes (or the server can't tell, `null`), the button stays, because hiding
 * a sign-in route that may well work is worse than one that answers "not
 * enabled".
 */
export function useAuthProviders() {
    const [off, setOff] = useState({ sso: false, google: false });
    useEffect(() => {
        let cancelled = false;
        getAuthProviders()
            .then((providers) => {
                if (cancelled) return;
                setOff({
                    sso: providers?.sso === false,
                    google: providers?.google === false,
                });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);
    return { showSso: !off.sso, showGoogle: !off.google };
}
