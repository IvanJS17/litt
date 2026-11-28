import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;

describe("formatBytes", () => {
    it("writes whole bytes below 1 KB", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1)).toBe("1 B");
        expect(formatBytes(1023)).toBe("1023 B");
    });

    it("steps up at each power of 1024", () => {
        expect(formatBytes(KIB)).toBe("1.0 KB");
        expect(formatBytes(MIB - 1)).toBe("1024.0 KB");
        expect(formatBytes(MIB)).toBe("1.0 MB");
        expect(formatBytes(GIB - 1)).toBe("1024.0 MB");
        expect(formatBytes(GIB)).toBe("1.0 GB");
        expect(formatBytes(2 * GIB)).toBe("2.0 GB");
        expect(formatBytes(10.5 * GIB)).toBe("10.5 GB");
        expect(formatBytes(TIB - 1)).toBe("1024.0 GB");
        expect(formatBytes(TIB)).toBe("1.0 TB");
        expect(formatBytes(3.25 * TIB)).toBe("3.3 TB");
    });

    it("keeps the TB step for anything larger", () => {
        expect(formatBytes(5000 * TIB)).toBe("5000.0 TB");
    });

    it("keeps what the two older copies showed for the values they handled", () => {
        expect(formatBytes(500)).toBe("500 B");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(204800)).toBe("200.0 KB");
        expect(formatBytes(5.5 * MIB)).toBe("5.5 MB");
        expect(formatBytes(900 * MIB)).toBe("900.0 MB");
    });

    it("uses the locale's number format when given one", () => {
        const format = {
            number: (value: number, options?: Intl.NumberFormatOptions) =>
                new Intl.NumberFormat("es-MX", options).format(value),
        };
        expect(formatBytes(10.5 * GIB, format)).toBe("10.5 GB");
        expect(formatBytes(1536, format)).toBe("1.5 KB");
        expect(formatBytes(2 * GIB, format)).toBe("2.0 GB");
        expect(formatBytes(1023, format)).toBe("1023 B");
        const german = {
            number: (value: number, options?: Intl.NumberFormatOptions) =>
                new Intl.NumberFormat("de-DE", options).format(value),
        };
        expect(formatBytes(10.5 * GIB, german)).toBe("10,5 GB");
        expect(formatBytes(1023, german)).toBe("1023 B");
    });
});
