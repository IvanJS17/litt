/**
 * The theme this browser last showed, so a reload paints dark before the
 * profile (the source of truth) answers. Not a preference of its own: it
 * follows the profile and goes back to light on sign-out.
 */
export const THEME_STORAGE_KEY = "litt:theme";

export function applyDarkMode(enabled: boolean): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", enabled);
    document.documentElement.style.colorScheme = enabled ? "dark" : "light";
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
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"){var d=document.documentElement;d.classList.add("dark");d.style.colorScheme="dark"}}catch(e){}`;
