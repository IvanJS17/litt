import { describe, expect, it } from "vitest";
import { formatBytes } from "./ProjectPageParts";

// What the document lists have always shown, pinned before the shared helper
// replaced the private formatter.
describe("ProjectPageParts formatBytes", () => {
    it("keeps its output for bytes, kilobytes and megabytes", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1023)).toBe("1023 B");
        expect(formatBytes(1024)).toBe("1.0 KB");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(1024 * 1024 - 1)).toBe("1024.0 KB");
        expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
        expect(formatBytes(5.5 * 1024 * 1024)).toBe("5.5 MB");
    });
});
