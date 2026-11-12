import type { AppTranslate } from "@/i18n/Translate";

/** Compact elapsed time for history rows; omit missing or invalid timestamps. */
export function formatElapsedTime(
    t: AppTranslate,
    timestamp: string | null | undefined,
    now = Date.now(),
): string | null {
    if (!timestamp) return null;
    const createdAt = Date.parse(timestamp);
    if (!Number.isFinite(createdAt)) return null;
    const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
    if (minutes < 1) return t("shared.relative.now");
    if (minutes < 60) return t("shared.relative.minutes", { count: minutes });
    if (minutes < 1440) return t("shared.relative.hours", { count: Math.floor(minutes / 60) });
    return t("shared.relative.days", { count: Math.floor(minutes / 1440) });
}
