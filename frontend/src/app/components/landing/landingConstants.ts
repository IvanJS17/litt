export { SUPPORT_EMAIL, SOURCE_REPOSITORY_URL } from "@mike/client";

/** Anchors of the header navigation. */
export const SECTION_IDS = {
    features: "funciones",
    why: "por-que",
    soon: "proximamente",
    trust: "confianza",
    access: "acceso",
} as const;

/** The anchor v1 used for what is now `#funciones`: old shared links still arrive with it. */
export const LEGACY_FEATURES_ANCHOR = "que-hace";

/** The hero's buttons: the header's button docks while these are in view. */
export const HERO_CTA_ID = "landing-hero-cta";

/** The ids the mobile menu names (the button's `aria-controls` and the skip link it makes inert). */
export const MENU_ID = "landing-menu";
export const MENU_BUTTON_ID = "landing-menu-button";
export const SKIP_LINK_ID = "landing-skip";
export const MAIN_ID = "main";

export const AGPL_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

/** The README section with the upstream attribution and credits. */
export const ATTRIBUTION_ANCHOR = "#attribution";
