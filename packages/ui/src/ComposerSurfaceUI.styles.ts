/**
 * The chat composer as a sheet ("hoja", owner decision 2026-11-13): an opaque
 * surface with a 1 px ring and one soft shadow, in place of liquid glass. Its
 * colors are the `--litt-composer-*` tokens in `DesignTokensUI.css`, and the
 * neutral focus ring and the text-colored caret live in the `.litt-composer`
 * rule next to them: amber never marks the field while typing.
 *
 * The corner radius is the send button's plus the 8 px margin: 9 + 8 = 17 px
 * on the web, 12 + 8 = 20 px with a finger (`pointer-coarse`), and
 * 10 + 8 = 18 px in Word.
 */
export const COMPOSER_SURFACE_CLASS = "litt-composer";

/**
 * The surface of the menus that open from the composer (the model picker and
 * the "/" command menu): opaque, a 1 px ring in its shadow, no border. They
 * leave the sheet, so they are not glass. Add a radius of 14 px yourself.
 */
export const COMPOSER_MENU_CLASS = "litt-composer-menu";

export const COMPOSER_SURFACE_WEB_RADIUS_CLASS =
    "rounded-[17px] pointer-coarse:rounded-[20px]";

export const COMPOSER_SURFACE_WORD_RADIUS_CLASS = "rounded-[18px]";

/**
 * The ghost button of the composer's controls (attach, model, key, "Revisar"),
 * the same family as the send button: no fill, same height and corners.
 * Resting text is gray-500 (6.00:1 light, 5.98:1 dark), a hover is a tinta
 * (papel) tint, an open menu is the stronger tint, and keyboard focus is the
 * global amber outline. Combine with a size class below.
 */
export const COMPOSER_GHOST_BUTTON_CLASS =
    "keyboard-focus-ring relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border-0 bg-transparent text-gray-500 transition-colors duration-150 motion-reduce:transition-none enabled:hover:bg-interactive-soft enabled:hover:text-gray-700 aria-expanded:bg-interactive-soft-strong aria-expanded:text-gray-900 enabled:aria-expanded:hover:bg-interactive-soft-strong enabled:aria-expanded:hover:text-gray-900 disabled:cursor-default disabled:opacity-50";

/** Web: 30 px, 9 px corners; 40 px and 12 px with a finger. */
export const COMPOSER_GHOST_WEB_SIZE_CLASS =
    "h-7.5 rounded-[9px] px-2 text-sm pointer-coarse:h-10 pointer-coarse:rounded-[12px]";
export const COMPOSER_GHOST_WEB_ICON_CLASS =
    "w-7.5 px-0 pointer-coarse:w-10";

/** Word: 32 px, 10 px corners. */
export const COMPOSER_GHOST_WORD_SIZE_CLASS =
    "h-8 rounded-[10px] px-2 text-[0.8125rem]";
export const COMPOSER_GHOST_WORD_ICON_CLASS = "w-8 px-0";
