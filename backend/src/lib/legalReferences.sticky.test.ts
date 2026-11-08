import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STICKY_PATTERNS, sticky } from "./legalReferences";

describe("sticky() only reads patterns anchored with ^", () => {
    it("throws for a pattern that does not start with ^", () => {
        expect(() => sticky(/abc/, "abc", 0)).toThrow(/\^/);
        expect(() => sticky(/(?:^a)|b/, "b", 0)).toThrow();
    });

    it("throws for a pattern with the g or y flag", () => {
        expect(() => sticky(/^abc/g, "abc", 0)).toThrow();
        expect(() => sticky(/^abc/y, "abc", 0)).toThrow();
    });

    it("reads an anchored pattern from the given position only", () => {
        expect(sticky(/^b+/, "abbc", 1)?.[0]).toBe("bb");
        expect(sticky(/^b+/, "abbc", 0)).toBeNull();
    });

    it("every pattern passed to sticky() in the module is anchored and carries no g or y flag", () => {
        const names = Object.keys(STICKY_PATTERNS);
        expect(names.length).toBeGreaterThanOrEqual(13);
        for (const name of names) {
            const pattern = STICKY_PATTERNS[name];
            expect(pattern.source.startsWith("^"), name).toBe(true);
            expect(pattern.global || pattern.sticky, name).toBe(false);
            expect(() => sticky(pattern, "", 0), name).not.toThrow();
        }
    });

    it("every call site of sticky() in the source passes a registered pattern (no inline literal)", () => {
        const source = readFileSync(join(__dirname, "legalReferences.ts"), "utf8");
        const arguments_ = [...source.matchAll(/\bsticky\(\s*([^,\s)]+)/g)].map((match) => match[1]);
        const called = arguments_.filter((argument) => argument !== "pattern:");
        expect(called.length).toBeGreaterThanOrEqual(14);
        for (const argument of called) expect(Object.keys(STICKY_PATTERNS), argument).toContain(argument);
        const used = new Set(called);
        for (const name of Object.keys(STICKY_PATTERNS)) expect(used.has(name), `${name} is registered but never used`).toBe(true);
    });
});
