"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import { LittWordmark } from "@mike/ui";
import { PrimaryButton } from "./LandingCtas";
import { HERO_CTA_ID, SECTION_IDS } from "./landingConstants";
import { LANDING_FOCUS } from "./landingStyles";
import { chooseTheme, useIsDark } from "./useThemePreference";

function subscribeToScroll(listener: () => void): () => void {
    window.addEventListener("scroll", listener, { passive: true });
    return () => window.removeEventListener("scroll", listener);
}

/** True once the page has moved more than 4 px: the header then gets its rule. */
function useScrolled(): boolean {
    return useSyncExternalStore(
        subscribeToScroll,
        () => window.scrollY > 4,
        () => false,
    );
}

/**
 * The header's button docks: while the hero's buttons are on screen it is
 * hidden (and inert), and when they leave it slides in, so there is never a
 * second "Iniciar sesión" next to the first. No animation under reduced
 * motion. Without JavaScript it stays hidden; the hero's own buttons remain.
 */
function useDocked(): boolean {
    const [heroInView, setHeroInView] = useState(true);
    useEffect(() => {
        const target = document.getElementById(HERO_CTA_ID);
        if (!target || typeof IntersectionObserver === "undefined") {
            // No hero buttons to wait for (or no observer): show the header's.
            const frame = requestAnimationFrame(() => setHeroInView(false));
            return () => cancelAnimationFrame(frame);
        }
        const observer = new IntersectionObserver(
            (entries) => setHeroInView(entries[0]?.isIntersecting ?? false),
            // The sticky header covers the top 76 px of the viewport.
            { rootMargin: "-76px 0px 0px 0px" },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, []);
    return !heroInView;
}

export function LandingHeader({ signedIn }: { signedIn: boolean }) {
    const t = useTranslations();
    const scrolled = useScrolled();
    const docked = useDocked();
    const dark = useIsDark();

    const navLink = `rounded-sm text-base text-muted-foreground no-underline pointer-fine:hover:text-foreground pointer-fine:hover:underline ${LANDING_FOCUS}`;

    return (
        <header
            id="top"
            data-scrolled={scrolled}
            className="landing-header sticky top-0 z-20 bg-surface-desk pt-[env(safe-area-inset-top)] transition-shadow duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]"
        >
            <div className="landing-wrap flex min-h-16 items-center gap-2 min-[880px]:min-h-19">
                <a
                    href="#top"
                    aria-label={t("landing.header.home")}
                    className={`-ms-2 inline-block rounded-md leading-none min-[880px]:-ms-3 ${LANDING_FOCUS}`}
                >
                    {/* x = 22 on a phone, 33 from 880 px (36u × 18.371u at u = 3 px: 108 × 56) */}
                    <LittWordmark
                        x={22}
                        decorative
                        className="min-[880px]:h-[56px] min-[880px]:w-[108px]"
                    />
                </a>
                <nav
                    aria-label={t("landing.header.nav")}
                    className="mx-auto hidden gap-7 min-[880px]:flex"
                >
                    <a href={`#${SECTION_IDS.what}`} className={navLink}>
                        {t("landing.nav.what")}
                    </a>
                    <a href={`#${SECTION_IDS.soon}`} className={navLink}>
                        {t("landing.nav.soon")}
                    </a>
                    <a href={`#${SECTION_IDS.trust}`} className={navLink}>
                        {t("landing.nav.trust")}
                    </a>
                </nav>
                <div className="ms-auto flex items-center gap-1 min-[880px]:ms-0">
                    <button
                        type="button"
                        aria-label={dark ? t("landing.header.toLight") : t("landing.header.toDark")}
                        onClick={() => chooseTheme(dark ? "light" : "dark")}
                        className={`grid size-11 place-items-center rounded-full text-foreground transition-colors duration-150 active:bg-interactive-soft-strong pointer-fine:hover:bg-interactive-soft ${LANDING_FOCUS}`}
                    >
                        {/* Both are drawn; the `.dark` class on <html> (set before paint) shows one. */}
                        <Moon
                            aria-hidden="true"
                            className="size-5 dark:hidden"
                            strokeWidth={1.6}
                        />
                        <Sun
                            aria-hidden="true"
                            className="hidden size-5 dark:block"
                            strokeWidth={1.6}
                        />
                    </button>
                    <PrimaryButton
                        signedIn={signedIn}
                        small
                        inert={!docked}
                        data-docked={docked}
                        className={`transition-[clip-path,opacity,background-color,transform] duration-[220ms] motion-reduce:transition-none ${
                            docked
                                ? "[clip-path:inset(0_0_0_0_round_999px)]"
                                : "pointer-events-none opacity-0 [clip-path:inset(0_0_0_100%_round_999px)]"
                        }`}
                    />
                </div>
            </div>
        </header>
    );
}
