/**
 * Turns the profile's dark theme on or off for the whole document. The web
 * app and the Word add-in both call this; the colors come from the `.dark`
 * rules in packages/ui/styles (DesignTokensUI.css and DarkPaletteUI.css).
 */
export function applyDarkMode(enabled: boolean): void {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", enabled);
    document.documentElement.style.colorScheme = enabled ? "dark" : "light";
}
