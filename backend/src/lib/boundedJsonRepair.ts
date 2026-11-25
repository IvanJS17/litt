// jsonrepair declares "type": "module" but ships a CommonJS build; importing
// it normally trips TS1479 under this package's Node16 CJS resolution.
const { jsonrepair } = require("jsonrepair") as {
    jsonrepair: (text: string) => string;
};

import { performance } from "node:perf_hooks";
import vm from "node:vm";

import { assertBoundedText, BoundedTextError } from "./modelJsonFence";

/**
 * The one place where text a model wrote is repaired as JSON. The library's time is not linear in
 * the size of a damaged text, and no property of the text tells how long it will take. So its time
 * is bounded directly: every call runs under a synchronous deadline, and the repairs of one reading
 * share one time budget. A repair that does not finish in time is refused.
 */

/** A repair did not finish within the time it was given. */
export class RepairDeadlineError extends Error {
    readonly code = "repair_deadline";
    constructor(
        readonly length: number,
        readonly allowedMs: number,
        options?: { cause?: unknown },
    ) {
        super(`The repair of a text of ${length} characters did not finish within ${allowedMs} ms`, options);
        this.name = "RepairDeadlineError";
    }
}

/** The time left for the repairs of one reading, shared by every text it repairs. */
export class RepairBudget {
    remaining: number;
    constructor(totalMs: number) {
        this.remaining = totalMs;
    }
}

/** The library ran out of stack on a text: too deeply nested for it to be repaired. */
export class RepairDepthError extends Error {
    readonly code = "repair_depth";
    constructor(
        readonly length: number,
        options?: { cause?: unknown },
    ) {
        super(`The repair of a text of ${length} characters is nested too deeply to be repaired`, options);
        this.name = "RepairDepthError";
    }
}

/** A repair was refused by a bound: the size of its text, its time or its nesting. */
export function isRepairRefusal(error: unknown): boolean {
    return error instanceof BoundedTextError || error instanceof RepairDeadlineError || error instanceof RepairDepthError;
}

/** The longest deadline the engine accepts is 2^32 - 1 ms; a repair is never given more than this. */
export const MAX_REPAIR_DEADLINE_MS = 2 ** 31;

/** The one whole-millisecond deadline of a repair; `0` when it is not a finite number of at least 1. */
function deadlineOf(milliseconds: number): number {
    if (!Number.isFinite(milliseconds)) return 0;
    const whole = Math.floor(milliseconds);
    return whole >= 1 ? Math.min(whole, MAX_REPAIR_DEADLINE_MS) : 0;
}

// The library's error is made in the context's realm, so `instanceof RangeError` does not hold.
const isStackOverflow = (error: unknown) =>
    (error as { name?: unknown } | null)?.name === "RangeError" && /call stack/i.test(String((error as { message?: unknown }).message));

// The library runs inside a context so that the engine can stop it at a deadline while the caller
// stays synchronous. The context is made once, and holds the text only while a repair runs.
type RepairContext = { repair: (text: string) => string; input: string };
let repairContext: RepairContext | null = null;
let repairScript: vm.Script | null = null;

function context(): { ctx: RepairContext; script: vm.Script } {
    if (!repairContext || !repairScript) {
        repairContext = vm.createContext({ repair: jsonrepair, input: "" }) as RepairContext;
        repairScript = new vm.Script("repair(input)");
    }
    return { ctx: repairContext, script: repairScript };
}

/** Seam for tests: told the size and the deadline of every repair that is run. */
let repairObserver: ((chars: number, allowedMs: number) => void) | null = null;
export function setRepairObserverForTests(observer: ((chars: number, allowedMs: number) => void) | null): void {
    repairObserver = observer;
}

/** Seam for tests: the text the context holds now (empty unless a repair is running). */
export function repairContextInputForTests(): string {
    return context().ctx.input;
}

/**
 * The repaired JSON text of `text`. Throws `BoundedTextError` for a text over `maxChars`;
 * `RepairDeadlineError` when the repair did not finish within the time left in `budget` (or
 * `limits.maxMs` without one) or that time is not a usable deadline; `RepairDepthError` when the
 * library ran out of stack; any other error is the library's own, for a text it cannot repair.
 * The wall time of the repair, whatever its end, is taken from `budget`.
 */
export function repairJson(text: string, limits: { maxChars: number; maxMs: number }, budget?: RepairBudget): string {
    assertBoundedText(text, limits.maxChars);
    const allowedMs = deadlineOf(budget ? budget.remaining : limits.maxMs);
    if (allowedMs < 1) throw new RepairDeadlineError(text.length, 0);
    repairObserver?.(text.length, allowedMs);
    const { ctx, script } = context();
    const started = performance.now();
    try {
        ctx.input = text;
        return script.runInContext(ctx, { timeout: allowedMs }) as string;
    } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
            throw new RepairDeadlineError(text.length, allowedMs, { cause: error });
        }
        if (isStackOverflow(error)) throw new RepairDepthError(text.length, { cause: error });
        throw error;
    } finally {
        ctx.input = "";
        if (budget) budget.remaining -= performance.now() - started;
    }
}
