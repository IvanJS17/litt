/**
 * The theme a person chose: Claro, Oscuro, or Automático (`system`), which
 * follows the device and changes with it. The profile stores this preference,
 * never the result (`dark` or `light`).
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** What the page can actually be drawn as. */
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME: Theme = "system";

export function isTheme(value: unknown): value is Theme {
    return (THEMES as readonly unknown[]).includes(value);
}

/** The query Automático follows. */
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Whether the device asks for a dark page right now (false where it cannot say). */
export function systemPrefersDark(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/** `system` becomes what the device asks for; the other two are themselves. */
export function resolveTheme(
    theme: Theme,
    systemDark: boolean = systemPrefersDark(),
): ResolvedTheme {
    if (theme === "system") return systemDark ? "dark" : "light";
    return theme;
}

/**
 * Calls `onChange` each time the device switches between light and dark, and
 * returns the function that stops listening. Where the browser cannot say
 * (no matchMedia), nothing is listened to.
 */
export function watchSystemTheme(onChange: (systemDark: boolean) => void): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
    }
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    const listener = (event: { matches: boolean }) => onChange(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
}

/**
 * Turns the dark theme on or off for the whole document. The web app and the
 * Word add-in both call this; the colors come from the `.dark` rules in
 * packages/ui/styles (DesignTokensUI.css and DarkPaletteUI.css).
 */
export function applyDarkMode(enabled: boolean): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", enabled);
    document.documentElement.style.colorScheme = enabled ? "dark" : "light";
}
