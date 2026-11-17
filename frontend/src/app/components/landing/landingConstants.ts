export { SUPPORT_EMAIL, SOURCE_REPOSITORY_URL } from "@mike/client";

/**
 * The access request and waitlist questionnaire (Tally), the one place its
 * address lives. `origen` says which button sent the visitor (`acceso`,
 * `inhouse`, `soon-<feature>`) and `lang` the page's language; the form reads
 * both as hidden fields.
 */
export const ACCESS_FORM_URL = "https://tally.so/r/2jAeGL";

export type AccessOrigin = "acceso" | "inhouse" | `soon-${string}`;

export function accessFormHref(origen: AccessOrigin, lang: string): string {
    const url = new URL(ACCESS_FORM_URL);
    url.searchParams.set("origen", origen);
    url.searchParams.set("lang", lang);
    return url.toString();
}

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
