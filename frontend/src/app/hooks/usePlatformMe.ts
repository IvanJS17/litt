"use client";

import { useEffect, useState } from "react";
import { getPlatformMe, type PlatformMe } from "@/app/lib/mikeApi";

/**
 * What the invite-only beta lets the signed-in person do, or `null` while it
 * loads or if it cannot be read. Callers hide things only on a definite
 * answer: the server enforces the rules either way.
 */
export function usePlatformMe(userId?: string | undefined): PlatformMe | null {
    const [me, setMe] = useState<PlatformMe | null>(null);
    useEffect(() => {
        let disposed = false;
        getPlatformMe()
            .then((value) => {
                if (!disposed) setMe(value);
            })
            .catch(() => {});
        return () => {
            disposed = true;
        };
    }, [userId]);
    return me;
}
