"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The settings home on a phone. The list itself is drawn by the settings
 * frame (SettingsShell); this page has nothing of its own. From 768 px up
 * there is no list, so it leads to the Account page, `/settings`.
 */
export default function SettingsPhoneHomePage() {
    const router = useRouter();
    useEffect(() => {
        const wide = window.matchMedia("(min-width: 768px)");
        const leave = () => {
            if (wide.matches) router.replace("/settings");
        };
        leave();
        wide.addEventListener("change", leave);
        return () => wide.removeEventListener("change", leave);
    }, [router]);
    return null;
}
