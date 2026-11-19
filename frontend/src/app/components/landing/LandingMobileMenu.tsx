"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { RemoveScroll } from "react-remove-scroll";
import { PrimaryButton, RequestAccessButton } from "./LandingCtas";
import { LandingLanguage } from "./LandingLanguage";
import { LandingThemeControl } from "./LandingThemeControl";
import { MENU_ID, SECTION_IDS } from "./landingConstants";
import { LANDING_FOCUS } from "./landingStyles";
import type { MobileMenu } from "./useMobileMenu";

/** What the panel takes from `useMobileMenu` (the header destructures the hook, so refs reach the panel only as props). */
export type MobileMenuPanelProps = Pick<
    MobileMenu,
    "open" | "shown" | "panelRef" | "firstLinkRef" | "close" | "goToSection"
> & { signedIn: boolean };

const LINKS = [
    { id: SECTION_IDS.training, label: "landing.nav.training" },
    { id: SECTION_IDS.features, label: "landing.nav.features" },
    { id: SECTION_IDS.why, label: "landing.nav.why" },
    { id: SECTION_IDS.soon, label: "landing.nav.soon" },
    { id: SECTION_IDS.trust, label: "landing.nav.trust" },
] as const;

const LEGAL_LINK = `inline-flex min-h-11 items-center rounded-sm text-base text-muted-foreground underline decoration-interactive-border underline-offset-4 pointer-fine:hover:text-foreground ${LANDING_FOCUS}`;

/**
 * The phone's menu: the four sections, the two buttons, theme and language
 * (the same controls and the same preferences as the footer, which is far away
 * on a phone) and the legal links. It is a child of the sticky header so it
 * starts right under it, and its content is always in the DOM: closed it only
 * carries `hidden`. The backdrop is drawn by `LandingHeader`.
 */
export function LandingMobileMenu({
    open,
    shown,
    panelRef,
    firstLinkRef,
    close,
    goToSection,
    signedIn,
}: MobileMenuPanelProps) {
    const t = useTranslations();
    const leave = { onClick: () => close({ instant: true }) };

    return (
        <RemoveScroll ref={panelRef} forwardProps enabled={open} allowPinchZoom>
            <div
                id={MENU_ID}
                hidden={!shown}
                className="landing-menu min-[880px]:hidden"
            >
                <nav aria-label={t("landing.header.nav")}>
                    <ul>
                        {LINKS.map(({ id, label }, index) => (
                            <li key={id}>
                                <a
                                    ref={index === 0 ? firstLinkRef : undefined}
                                    href={`#${id}`}
                                    onClick={(event) => goToSection(event, id)}
                                    className={`landing-menu-link ${LANDING_FOCUS} focus-visible:-outline-offset-2`}
                                >
                                    {t(label)}
                                </a>
                            </li>
                        ))}
                    </ul>
                </nav>
                <div className="landing-wrap mt-6 grid gap-2.5">
                    <PrimaryButton signedIn={signedIn} className="w-full" {...leave} />
                    <RequestAccessButton className="w-full" {...leave} />
                </div>
                <div className="landing-wrap mt-6 flex flex-wrap gap-2.5">
                    <LandingThemeControl />
                    <LandingLanguage />
                </div>
                <ul className="landing-wrap mt-4 flex flex-wrap gap-x-5">
                    <li>
                        <Link href="/privacidad" className={LEGAL_LINK} {...leave}>
                            {t("landing.footer.privacy")}
                        </Link>
                    </li>
                    <li>
                        <Link href="/terminos" className={LEGAL_LINK} {...leave}>
                            {t("landing.footer.terms")}
                        </Link>
                    </li>
                </ul>
            </div>
        </RemoveScroll>
    );
}
