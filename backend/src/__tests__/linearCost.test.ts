import { afterEach, describe, expect, it, vi } from "vitest";
import { expectLinearCost, expectLinearCostAsync } from "./helpers/linearCost";

// The helper is tested on a clock the test drives, so the result does not depend on the speed of the machine:
// a function "takes" the time its cost formula gives for the size it is asked to read.
let clock = 0;
const sizesAsked: number[] = [];
const costly = (ms: (n: number) => number) => (n: number) => {
    sizesAsked.push(n);
    clock += ms(n);
};

vi.spyOn(performance, "now").mockImplementation(() => clock);
afterEach(() => {
    sizesAsked.length = 0;
});

describe("expectLinearCost", () => {
    // 0.04 ms for 200 characters, 41 ms for 6,400: far below a millisecond when small.
    const quadratic = costly((n) => n * n * 1e-6);
    const linear = costly((n) => n * 1e-4);

    it("accepts a cost that grows with the size", () => {
        expect(() => expectLinearCost(linear, { small: 200, large: 6_400 })).not.toThrow();
        expect(() => expectLinearCost(linear, { small: 2_000, large: 64_000 })).not.toThrow();
    });
    it("refuses a quadratic cost whose small run is too short to time", () => {
        expect(() => expectLinearCost(quadratic, { small: 200, large: 6_400 })).toThrow(/linear bound/);
        expect(() => expectLinearCost(quadratic, { small: 2_000, large: 64_000 })).toThrow(/linear bound/);
    });
    it("refuses it in the version for promises too", async () => {
        await expect(expectLinearCostAsync(async (n) => quadratic(n), { small: 200, large: 6_400 })).rejects.toThrow(/linear bound/);
        await expectLinearCostAsync(async (n) => linear(n), { small: 200, large: 6_400 });
    });
    it("times a run too short for the clock as the average of many, and reads only the two sizes asked", () => {
        expectLinearCost(linear, { small: 200, large: 6_400 });
        expect(new Set(sizesAsked)).toEqual(new Set([200, 6_400]));
        expect(sizesAsked.filter((n) => n === 200).length).toBeGreaterThan(100);
    });
});
