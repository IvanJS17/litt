import { expect } from "vitest";

type Size = { small: number; large: number };

// A test that compares times runs on a machine that may be busy or fast, so it
// never asks a single run to be fast, and never lets a floor decide the bound:
//   - the small input is timed over enough repetitions to last at least
//     SMALL_BATCH_MS (up to MAX_REPEATS), after a warm-up, and the fastest of
//     three such averages is taken: a run too short for the clock to read is
//     read as the average of many, not replaced by a minimum;
//   - the large input passes if ANY of up to three runs is within the bound (a
//     pause of the machine slows one run, never the three of a quadratic cost,
//     which are all far over a bound eight times wide);
//   - the bound is eight times what a linear cost projects from the small
//     average, and never under MIN_ALLOWED_MS: a large run shorter than that is
//     no cost worth a test, and the allowance keeps a pause of the machine
//     from failing a fast linear function.
const LARGE_RUNS = 3;
const SLACK = 8;
const SMALL_BATCH_MS = 5;
const MAX_REPEATS = 4096;
const MIN_ALLOWED_MS = 20;

function verdict(small: number[], large: number[], { small: smallSize, large: largeSize }: Size) {
    const allowedMs = Math.max(Math.min(...small) * (largeSize / smallSize) * SLACK, MIN_ALLOWED_MS);
    const largeMs = Math.min(...large);
    return { largeMs, allowedMs, ok: largeMs < allowedMs };
}

function check(result: ReturnType<typeof verdict>): void {
    expect(result.largeMs, `large input took ${result.largeMs.toFixed(1)} ms, linear bound ${result.allowedMs.toFixed(1)} ms`).toBeLessThan(result.allowedMs);
}

/**
 * Asserts that `run` costs time linear in its input size, without an absolute
 * time: it runs on a small and on a large input (`large / small` times
 * larger) and requires the large run to finish within eight times what a
 * linear cost would allow. Quadratic or worse cost misses the bound by a wide
 * margin.
 */
export function expectLinearCost(run: (size: number) => unknown, size: Size): void {
    const time = (n: number) => {
        const started = performance.now();
        run(n);
        return performance.now() - started;
    };
    const average = (n: number) => {
        let total = 0;
        let runs = 0;
        while (runs < MAX_REPEATS && (runs === 0 || total < SMALL_BATCH_MS)) {
            total += time(n);
            runs++;
        }
        return total / runs;
    };
    time(size.small);
    const small = [average(size.small), average(size.small), average(size.small)];
    const large = [time(size.large)];
    let result = verdict(small, large, size);
    while (!result.ok && large.length < LARGE_RUNS) {
        large.push(time(size.large));
        result = verdict(small, large, size);
    }
    check(result);
}

/** The same for a function that returns a promise. */
export async function expectLinearCostAsync(run: (size: number) => Promise<unknown>, size: Size): Promise<void> {
    const time = async (n: number) => {
        const started = performance.now();
        await run(n);
        return performance.now() - started;
    };
    const average = async (n: number) => {
        let total = 0;
        let runs = 0;
        while (runs < MAX_REPEATS && (runs === 0 || total < SMALL_BATCH_MS)) {
            total += await time(n);
            runs++;
        }
        return total / runs;
    };
    await time(size.small);
    const small = [await average(size.small), await average(size.small), await average(size.small)];
    const large = [await time(size.large)];
    let result = verdict(small, large, size);
    while (!result.ok && large.length < LARGE_RUNS) {
        large.push(await time(size.large));
        result = verdict(small, large, size);
    }
    check(result);
}
