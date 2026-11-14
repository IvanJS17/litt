import {
    THEMES,
    type ResolvedTheme,
    type Theme,
    applyDarkMode,
    isTheme,
    resolveTheme,
    watchSystemTheme,
} from "@mike/client";

export { THEMES, isTheme, resolveTheme };
export type { ResolvedTheme, Theme };

/**
 * The preference this browser last saved (`light`, `dark` or `system`), so a
 * reload paints the right page before the profile (the source of truth)
 * answers. It stores the preference and never its result: with `system`, the
 * device decides at every load. Not a preference of its own: it follows the
 * profile and goes back to light on sign-out.
 */
export const THEME_STORAGE_KEY = "litt:theme";

/** The brand's papel and tinta: the browser bar follows the page's theme. */
export const THEME_COLOR_LIGHT = "#ECECE6";
export const THEME_COLOR_DARK = "#151A26";

/**
 * Colours the browser's bar (Safari, the installed app) with the page: papel
 * on the light theme, tinta on the dark one. It follows the resolved theme,
 * so a `prefers-color-scheme` media query on the tag would be wrong when the
 * person chose a theme that differs from the device's.
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

function paint(resolved: ResolvedTheme): void {
    applyDarkMode(resolved === "dark");
    setThemeColor(resolved === "dark");
}

/** The one listener for Automático: replaced or dropped at every `applyTheme`. */
let stopWatchingDevice: (() => void) | null = null;

/**
 * The web app's theme switch. Paints the page now and remembers the
 * preference for the next first paint; `system` also follows the device live,
 * from here on, until another preference is applied. Returns what was painted.
 */
export function applyTheme(theme: Theme): ResolvedTheme | null {
    if (typeof document === "undefined") return null;
    stopWatchingDevice?.();
    stopWatchingDevice = null;
    const resolved = resolveTheme(theme);
    paint(resolved);
    if (theme === "system") {
        stopWatchingDevice = watchSystemTheme((systemDark) =>
            paint(systemDark ? "dark" : "light"),
        );
    }
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // Storage blocked: the theme still applies; only the next first
        // paint stays light until the profile loads.
    }
    return resolved;
}

/**
 * Runs inline in <head>, before the first paint, so a returning dark-mode
 * user never sees the light loader, and an Automático one gets what the device
 * asks for. It must do what applyTheme does, minus the live listener (the
 * profile's provider starts that). A constant (no user input), and the web app
 * sends no Content-Security-Policy (only backend-served pages do), so it needs
 * no nonce or hash; the value read from storage is only compared, never
 * written into the page.
 */
export const THEME_BOOT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)){var d=document.documentElement;d.classList.add("dark");d.style.colorScheme="dark"}}catch(e){}var m=document.createElement("meta");m.name="theme-color";m.content=document.documentElement.classList.contains("dark")?${JSON.stringify(THEME_COLOR_DARK)}:${JSON.stringify(THEME_COLOR_LIGHT)};document.head.appendChild(m)`;
