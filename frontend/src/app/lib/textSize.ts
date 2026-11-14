/**
 * The text size a person picks in Settings > Appearance. It is the root font
 * size: `html[data-text-size]` sets a percentage of the browser's base size
 * (normal 100 %, large 112.5 %, xlarge 125 %; see globals.css), so everything
 * written in rem scales with it. A person who already raised the browser's own
 * default keeps that on top.
 */
export const TEXT_SIZES = ["normal", "large", "xlarge"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const DEFAULT_TEXT_SIZE: TextSize = "normal";

/** The size this browser last showed, so a reload paints at it before the profile answers. */
export const TEXT_SIZE_STORAGE_KEY = "litt:text-size";

export function isTextSize(value: unknown): value is TextSize {
    return (TEXT_SIZES as readonly unknown[]).includes(value);
}

/**
 * Sets the size on the document root and remembers it for the next first
 * paint. `normal` removes the attribute: the page is then exactly as it was
 * before this setting existed.
 */
export function applyTextSize(size: TextSize): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (size === DEFAULT_TEXT_SIZE) root.removeAttribute("data-text-size");
    else root.setAttribute("data-text-size", size);
    try {
        window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
    } catch {
        // Storage blocked: the size still applies; only the next first paint
        // stays at 100 % until the profile loads.
    }
}

/**
 * Runs inline in <head>, before the first paint, next to the theme script, so
 * a person who chose a larger size never sees the page jump from 100 %. It
 * must do what applyTextSize does. A constant (no user input); the value read
 * from storage is only used if it is one of the two attribute values.
 */
export const TEXT_SIZE_BOOT_SCRIPT = `try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_STORAGE_KEY)});if(s===\"large\"||s===\"xlarge\")document.documentElement.setAttribute(\"data-text-size\",s)}catch(e){}`;
