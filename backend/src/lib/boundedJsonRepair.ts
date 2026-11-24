// jsonrepair declares "type": "module" but ships a CommonJS build; importing
// it normally trips TS1479 under this package's Node16 CJS resolution.
const { jsonrepair } = require("jsonrepair") as {
    jsonrepair: (text: string) => string;
};

import { assertBoundedText, BoundedTextError } from "./modelJsonFence";

/**
 * The one place where text a model wrote is repaired as JSON. The library's time is not linear in
 * the size of a damaged text: it re-reads the rest of a text for each quote that does not pair. So
 * a repair is only run on a text whose cost, counted before the library is called, is within what
 * its caller may spend, and a text it refuses is never handed to the library.
 */

/**
 * Every character the library treats as a quote, as of jsonrepair 3.15.0 (`isQuote` of its
 * `utils/stringUtils.js`: `"` `'` and the curly, grave and acute variants below). The test of this
 * file reads that classifier from the installed library and fails if it knows a quote this list
 * does not.
 */
const isRepairQuote = (code: number): boolean =>
    code === 0x22 || // "
    code === 0x27 || // '
    code === 0x2018 || // left single curly quote
    code === 0x2019 || // right single curly quote
    code === 0x201c || // left double curly quote
    code === 0x201d || // right double curly quote
    code === 0x60 || // grave accent
    code === 0xb4; // acute accent

/** How many quote characters the library would see in `text`. */
export function countRepairQuotes(text: string): number {
    let quotes = 0;
    for (let i = 0; i < text.length; i++) if (isRepairQuote(text.charCodeAt(i))) quotes++;
    return quotes;
}

/**
 * The most work the repair of one text may be asked to do unless its caller says otherwise, in
 * characters times quote characters (plus one). A cut-off string of any length has few quotes and
 * stays well inside it.
 */
const REPAIR_MAX_WORK = 250_000_000;

/** The work a repair of `text` is counted as: its length times its quote characters (plus one). */
const repairWork = (length: number, quotes: number): number => length * (quotes + 1);

/** A reading's repairs could not all be paid for: the budget shared by them was spent. */
export class RepairBudgetSpentError extends Error {
    readonly code = "repair_budget_spent";
    constructor(
        readonly cost: number,
        readonly remaining: number,
        readonly length: number,
    ) {
        super(`The repair of a text of ${length} characters costs ${cost}, and the budget shared by the repairs of one reading has ${remaining} left`);
        this.name = "RepairBudgetSpentError";
    }
}

/**
 * What is left to spend on repairs, shared by every text of one reading. Every repair costs its work
 * plus `callCost`, so that a reading of many small texts is bounded in their number as well.
 */
export class RepairBudget {
    remaining: number;
    constructor(
        total: number,
        readonly callCost: number,
    ) {
        this.remaining = total;
    }
}

/** A repair was refused by a bound: the limit of its own text or the budget of its reading. */
export function isRepairRefusal(error: unknown): boolean {
    return error instanceof BoundedTextError || error instanceof RepairBudgetSpentError;
}

/** Seam for tests: told the size and the work of every repair that is run. */
let repairObserver: ((chars: number, work: number) => void) | null = null;
export function setRepairObserverForTests(observer: ((chars: number, work: number) => void) | null): void {
    repairObserver = observer;
}

/**
 * The repaired JSON text of `text`. Throws `BoundedTextError` for a text over `maxChars`, or over
 * what `limits.maxWork` (`REPAIR_MAX_WORK` unless given) allows for its quotes; `RepairBudgetSpentError` when `budget` cannot pay
 * for it; any other error is the library's own, for a text it cannot repair.
 */
export function repairJson(text: string, limits: { maxChars: number; maxWork?: number }, budget?: RepairBudget): string {
    assertBoundedText(text, limits.maxChars);
    const quotes = countRepairQuotes(text);
    assertBoundedText(text, Math.floor((limits.maxWork ?? REPAIR_MAX_WORK) / (quotes + 1)));
    const work = repairWork(text.length, quotes);
    if (budget) {
        const cost = work + budget.callCost;
        if (cost > budget.remaining) throw new RepairBudgetSpentError(cost, budget.remaining, text.length);
        budget.remaining -= cost;
    }
    repairObserver?.(text.length, work);
    return jsonrepair(text);
}
