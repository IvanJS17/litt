// The themes LiTT ships: Claro, Oscuro, and Automático (follows the device).
// The database CHECK on user_profiles.theme (migration 20261114_10) lists the
// same values.
import type { Theme } from "@mike/contracts";

export const THEMES = ["light", "dark", "system"] as const satisfies readonly Theme[];

export function isTheme(value: unknown): value is Theme {
    return (THEMES as readonly unknown[]).includes(value);
}
