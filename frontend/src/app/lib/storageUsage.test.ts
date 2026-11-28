import { describe, expect, it } from "vitest";
import { isStorageUsage, storageMeter } from "./storageUsage";

const GIB = 1024 ** 3;

describe("storageMeter", () => {
    it("is quiet below 80 %", () => {
        expect(storageMeter({ usedBytes: 0, limitBytes: 100 })).toEqual({ percent: 0, level: "ok" });
        expect(storageMeter({ usedBytes: 799, limitBytes: 1000 })).toEqual({ percent: 79, level: "ok" });
        expect(storageMeter({ usedBytes: 79.9, limitBytes: 100 })).toEqual({ percent: 79, level: "ok" });
    });

    it("says almost full from exactly 80 % up to the limit", () => {
        expect(storageMeter({ usedBytes: 800, limitBytes: 1000 })).toEqual({ percent: 80, level: "almostFull" });
        expect(storageMeter({ usedBytes: 8 * GIB, limitBytes: 10 * GIB })).toEqual({ percent: 80, level: "almostFull" });
        expect(storageMeter({ usedBytes: 999, limitBytes: 1000 })).toEqual({ percent: 99, level: "almostFull" });
    });

    it("says full at the limit and over it, and never goes past 100", () => {
        expect(storageMeter({ usedBytes: 1000, limitBytes: 1000 })).toEqual({ percent: 100, level: "full" });
        expect(storageMeter({ usedBytes: 1500, limitBytes: 1000 })).toEqual({ percent: 100, level: "full" });
        expect(storageMeter({ usedBytes: 11 * GIB, limitBytes: 10 * GIB })).toEqual({ percent: 100, level: "full" });
    });

    it("does not divide by a limit of zero", () => {
        expect(storageMeter({ usedBytes: 0, limitBytes: 0 })).toEqual({ percent: 100, level: "full" });
        expect(storageMeter({ usedBytes: 5, limitBytes: 0 })).toEqual({ percent: 100, level: "full" });
    });

    it("never draws below the start", () => {
        expect(storageMeter({ usedBytes: -5, limitBytes: 1000 })).toEqual({ percent: 0, level: "ok" });
    });
});

describe("isStorageUsage", () => {
    it("takes two finite figures that are not negative", () => {
        expect(isStorageUsage({ usedBytes: 0, limitBytes: 0 })).toBe(true);
        expect(isStorageUsage({ usedBytes: 5, limitBytes: 4 })).toBe(true);
    });

    it.each([
        null,
        "text",
        {},
        { usedBytes: 1 },
        { usedBytes: "1", limitBytes: 2 },
        { usedBytes: Number.NaN, limitBytes: 2 },
        { usedBytes: 1, limitBytes: Number.POSITIVE_INFINITY },
        { usedBytes: -1, limitBytes: 2 },
    ])("refuses %j", (value) => {
        expect(isStorageUsage(value)).toBe(false);
    });
});
