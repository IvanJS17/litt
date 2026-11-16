import { PIXEL_TEXT_CLASS } from "@mike/ui";

/**
 * Class lists the public start page repeats (docs/design-system.md; tokens
 * only, no palette colors). The page has no `dark:` classes: the tokens
 * change with the theme, and the inverted band reassigns them on its own
 * container (landing.css).
 */

/** The amber ring of the keyboard focus, 2 px with a 2 px gap (`--litt-accent`). */
export const LANDING_FOCUS =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const BUTTON_BASE = `inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none transition-[background-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] active:duration-100 ${LANDING_FOCUS}`;

/** Primary: tinta on papel in the light theme, papel on tinta in the dark one. */
export const LANDING_BUTTON_PRIMARY = `${BUTTON_BASE} bg-interactive text-interactive-foreground active:bg-interactive-pressed pointer-fine:hover:bg-interactive-hover`;

/** Secondary: transparent with a 1 px ring (tinta 50 % / papel 42 %). */
export const LANDING_BUTTON_SECONDARY = `${BUTTON_BASE} text-foreground ring-1 ring-inset ring-interactive-border active:bg-interactive-soft-strong pointer-fine:hover:bg-interactive-soft`;

/** 44 px tall; the header's is 40 px. */
export const LANDING_BUTTON_SIZE = "min-h-11 px-5 text-[1.0625rem] leading-none";
export const LANDING_BUTTON_SIZE_SM = "min-h-10 px-4 text-base leading-none";

/** Departure Mono: 11 px, capitals by CSS, only for the short details of SPEC §4. */
export const LANDING_PIXEL = `${PIXEL_TEXT_CLASS} uppercase tracking-normal [font-kerning:none]`;

/** "Próximamente": the detail with its 1 px ring (the visible text is aria-hidden). */
export const LANDING_TAG = `${LANDING_PIXEL} inline-flex w-fit items-center rounded-[4px] px-2 pt-[6px] pb-[5px] ring-1 ring-inset ring-interactive-border`;

/** A section's rule on top and its vertical rhythm. */
export const LANDING_SECTION =
    "border-t border-foreground/14 py-[clamp(64px,9vw,128px)]";

/** Hairline between rows (tinta 14 % / papel 14 %). */
export const LANDING_RULE = "border-foreground/14";

/** The reading column and the secondary text. */
export const LANDING_MUTED = "text-muted-foreground";
