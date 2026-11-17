"use client";

import { useEffect } from "react";
import { LEGACY_FEATURES_ANCHOR, SECTION_IDS } from "./landingConstants";

/**
 * The first version's section is now `#funciones`. A shared link that still
 * ends in `#que-hace` finds no element, so this swaps the hash and goes to the
 * section. It renders nothing.
 */
export function LegacyAnchor() {
    useEffect(() => {
        if (window.location.hash !== `#${LEGACY_FEATURES_ANCHOR}`) return;
        window.history.replaceState(null, "", `#${SECTION_IDS.features}`);
        document.getElementById(SECTION_IDS.features)?.scrollIntoView({ block: "start" });
    }, []);
    return null;
}
