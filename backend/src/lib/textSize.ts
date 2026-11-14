// The text sizes LiTT ships. The database CHECK on user_profiles.text_size
// (migration 20261113_60) lists the same values.
import type { TextSize } from "@mike/contracts";

export const TEXT_SIZES = ["normal", "large", "xlarge"] as const satisfies readonly TextSize[];

export function isTextSize(value: unknown): value is TextSize {
    return (TEXT_SIZES as readonly unknown[]).includes(value);
}
