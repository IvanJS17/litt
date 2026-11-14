/**
 * Departure Mono, the pixel face (`font-pixel`), for short details only.
 *
 * It is drawn at 11 px, fixed and not in rem: a pixel font is crisp only at
 * its design grid (at 11 px a line of text has two colors; at 12.4 px, 60). It
 * therefore does not follow the text-size setting, which is why it is limited
 * to pieces that are also written in normal text or in the accessible label:
 * shortcuts, counters, model routes and versions or commits. Never a phrase, a
 * button, a model name or a heading (docs/design-system.md, Typography).
 */
export const PIXEL_TEXT_CLASS = "font-pixel text-[11px] leading-none";

/** The most characters a pixel-font piece may have. */
export const PIXEL_TEXT_MAX_LENGTH = 12;

/**
 * `PIXEL_TEXT_CLASS` when `text` is a short detail (1 to 12 characters, one
 * word or token), otherwise `fallback`. A translated route name that does not
 * fit the rule falls back to the normal face instead of breaking it.
 */
export function pixelTextClass(text: string, fallback = ""): string {
    const length = [...text.trim()].length;
    return length >= 1 && length <= PIXEL_TEXT_MAX_LENGTH && !/\s/.test(text.trim())
        ? PIXEL_TEXT_CLASS
        : fallback;
}
