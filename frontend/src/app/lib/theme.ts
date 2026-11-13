import { applyDarkMode as applyDocumentDarkMode } from "@mike/client";

/**
 * The theme this browser last showed, so a reload paints dark before the
 * profile (the source of truth) answers. Not a preference of its own: it
 * follows the profile and goes back to light on sign-out.
 */
export const THEME_STORAGE_KEY = "litt:theme";

/** The brand's papel and tinta: the browser bar follows the page's theme. */
export const THEME_COLOR_LIGHT = "#ECECE6";
export const THEME_COLOR_DARK = "#151A26";

/**
 * Colours the browser's bar (Safari, the installed app) with the page: papel
 * on the light theme, tinta on the dark one. The theme is the person's
 * preference, not the system's, so a `prefers-color-scheme` media query on the
 * tag would be wrong.
 */
function setThemeColor(dark: boolean): void {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
    }
    meta.content = dark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/**
 * The web app's theme switch: the document change is shared with the Word
 * add-in (`@mike/client`); the web app also remembers it for the next first
 * paint.
 */
export function applyDarkMode(enabled: boolean): void {
    if (typeof document === "undefined") return;
    applyDocumentDarkMode(enabled);
    setThemeColor(enabled);
    try {
        window.localStorage.setItem(
            THEME_STORAGE_KEY,
            enabled ? "dark" : "light",
        );
    } catch {
        // Storage blocked: the theme still applies; only the next first
        // paint stays light until the profile loads.
    }
}

/**
 * Runs inline in <head>, before the first paint, so a returning dark-mode
 * user never sees the light loader. It must do what applyDarkMode(true)
 * does. A constant (no user input), and the web app sends no
 * Content-Security-Policy (only backend-served pages do), so it needs no
 * nonce or hash.
 */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"){var d=document.documentElement;d.classList.add("dark");d.style.colorScheme="dark"}}catch(e){}var m=document.createElement("meta");m.name="theme-color";m.content=document.documentElement.classList.contains("dark")?${JSON.stringify(THEME_COLOR_DARK)}:${JSON.stringify(THEME_COLOR_LIGHT)};document.head.appendChild(m)`;
