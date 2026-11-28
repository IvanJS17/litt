import type { StorageUsage } from "@mike/contracts";

/** From this share of the limit the space is called almost full (4/5). */
const ALMOST_FULL_NUMERATOR = 4;
const ALMOST_FULL_DENOMINATOR = 5;

/**
 * Whether a read gave the two figures as numbers that can be shown: finite and
 * not negative. Anything else is treated as a read that failed.
 */
export function isStorageUsage(value: unknown): value is StorageUsage {
    if (typeof value !== "object" || value === null) return false;
    const { usedBytes, limitBytes } = value as Record<string, unknown>;
    return [usedBytes, limitBytes].every(
        (figure) => typeof figure === "number" && Number.isFinite(figure) && figure >= 0,
    );
}

export type StorageLevel = "ok" | "almostFull" | "full";

export type StorageMeter = {
    /** A whole number from 0 to 100, for the meter and the percentage shown. */
    percent: number;
    level: StorageLevel;
};

/**
 * What the meter and the notice show for a space. At the limit or over it the
 * space is full (new files are refused); from 80 % it is almost full. A limit
 * of zero is full, and the bar never draws past its end whatever the use is;
 * the figures themselves are shown as they are.
 */
export function storageMeter({ usedBytes, limitBytes }: StorageUsage): StorageMeter {
    if (usedBytes >= limitBytes) return { percent: 100, level: "full" };
    const percent = Math.max(0, Math.floor((usedBytes * 100) / limitBytes));
    const almostFull =
        usedBytes * ALMOST_FULL_DENOMINATOR >= limitBytes * ALMOST_FULL_NUMERATOR;
    return { percent, level: almostFull ? "almostFull" : "ok" };
}
