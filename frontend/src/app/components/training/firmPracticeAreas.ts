"use client";

import { useEffect, useMemo, useState } from "react";
import { getOrgFirmProfile } from "@/app/lib/mikeApi";
import { PRACTICE_AREA_OPTIONS } from "@/app/onboarding/options";

// The practice areas Formación offers (docs/training.md, «Practice area»):
// the ones in the firm's profile, or the whole catalog when it names none.

/** The catalog areas, without «Other» (a firm without a profile choice offers all of them). */
export const ALL_PRACTICE_AREAS: readonly string[] = PRACTICE_AREA_OPTIONS.filter(
    (area) => area !== "Other",
);

/**
 * The practice areas a firm offers for a stage: the ones in its profile, or
 * the whole list when the profile names none (or has not loaded or failed).
 */
export function firmPracticeAreas(profileAreas: readonly string[] | null | undefined): readonly string[] {
    const own = [...new Set((profileAreas ?? []).map((area) => area.trim()).filter(Boolean))];
    return own.length > 0 ? own : ALL_PRACTICE_AREAS;
}

/** The areas of the firm's profile (`organizations.firm_profile`); null while loading or when it cannot be read. */
export function useFirmPracticeAreas(orgId: string): readonly string[] {
    const [loaded, setLoaded] = useState<{ orgId: string; areas: string[] | null } | null>(null);
    useEffect(() => {
        let cancelled = false;
        getOrgFirmProfile(orgId).then(
            (settings) => {
                if (!cancelled) setLoaded({ orgId, areas: settings.profile?.practice_areas ?? null });
            },
            () => {
                if (!cancelled) setLoaded({ orgId, areas: null });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [orgId]);
    return useMemo(
        () => firmPracticeAreas(loaded?.orgId === orgId ? loaded.areas : null),
        [loaded, orgId],
    );
}
