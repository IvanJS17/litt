// Exact decimal arithmetic for the methodology calculators (docs/training.md).
//
// A value is `n / 10^s` with `n` a BigInt: no float anywhere, so a legal or
// financial figure never drifts. Addition and multiplication are exact; the
// only inexact step is a division, and every division rounds explicitly,
// half away from zero (the rule the annex states).

export type Decimal = { readonly n: bigint; readonly s: number };

export class MethodologyError extends Error {
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = "MethodologyError";
    }
}

/** At most 30 integer digits and 12 decimals: more is not a figure from a document. */
const DECIMAL_PATTERN = /^(-?)(\d{1,30})(?:\.(\d{1,12}))?$/;
export const MAX_SCALE = 40;

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

const normalize = (value: Decimal): Decimal => {
    let { n, s } = value;
    while (s > 0 && n % 10n === 0n) {
        n /= 10n;
        s -= 1;
    }
    return { n, s };
};

/**
 * Reads a decimal written with a point and no separators or exponent.
 * Numbers are accepted for convenience through their shortest string, which
 * exponent notation (and so a float that needs it) cannot satisfy.
 */
export function parseDecimal(raw: unknown, label: string): Decimal {
    if (typeof raw === "number" && !Number.isSafeInteger(raw)) {
        throw new MethodologyError(
            "unsafe_number",
            `${label}: a JSON number cannot carry this value exactly (it is a decimal or larger than 9007199254740991). Send it as text, for example "9007199254740993" or "12.5".`,
        );
    }
    const text = typeof raw === "number" ? String(raw) : raw;
    if (typeof text !== "string") {
        throw new MethodologyError("invalid_number", `${label}: a number written as text is required.`);
    }
    const match = DECIMAL_PATTERN.exec(text.trim());
    if (!match) {
        throw new MethodologyError(
            "invalid_number",
            `${label}: "${text.trim().slice(0, 40)}" is not a plain decimal (digits with an optional point; no separators, symbols or exponent).`,
        );
    }
    const scale = match[3]?.length ?? 0;
    const magnitude = BigInt(match[2] + (match[3] ?? ""));
    return { n: match[1] === "-" ? -magnitude : magnitude, s: scale };
}

export const fromInt = (value: number | bigint): Decimal => ({ n: BigInt(value), s: 0 });

/** Brings two values to a common scale. */
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
    const s = Math.max(a.s, b.s);
    return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

export const add = (a: Decimal, b: Decimal): Decimal => {
    const [x, y, s] = align(a, b);
    return { n: x + y, s };
};

export const sub = (a: Decimal, b: Decimal): Decimal => {
    const [x, y, s] = align(a, b);
    return { n: x - y, s };
};

export const mul = (a: Decimal, b: Decimal): Decimal => ({ n: a.n * b.n, s: a.s + b.s });

export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
    const [x, y] = align(a, b);
    return x < y ? -1 : x > y ? 1 : 0;
}

export const isZero = (a: Decimal): boolean => a.n === 0n;
export const isNegative = (a: Decimal): boolean => a.n < 0n;

/** Integer division of `num` by `den` (den ≠ 0), half away from zero. */
function divRoundHalfAway(num: bigint, den: bigint): bigint {
    const negative = num < 0n !== den < 0n;
    const absNum = num < 0n ? -num : num;
    const absDen = den < 0n ? -den : den;
    let quotient = absNum / absDen;
    if ((absNum % absDen) * 2n >= absDen) quotient += 1n;
    return negative ? -quotient : quotient;
}

/** Rounds to `scale` decimals, half away from zero. */
export function roundTo(a: Decimal, scale: number): Decimal {
    if (a.s <= scale) return { n: a.n * pow10(scale - a.s), s: scale };
    return { n: divRoundHalfAway(a.n, pow10(a.s - scale)), s: scale };
}

/** `numerator / denominator` rounded to `scale` decimals. The only division. */
export function ratio(numerator: Decimal, denominator: Decimal, scale: number): Decimal {
    if (isZero(denominator)) {
        throw new MethodologyError("division_by_zero", "The denominator is zero.");
    }
    if (scale < 0 || scale > MAX_SCALE) throw new RangeError("scale out of range");
    // value = (nn / 10^sn) / (nd / 10^sd) = nn * 10^sd / (nd * 10^sn)
    const num = numerator.n * pow10(denominator.s + scale);
    const den = denominator.n * pow10(numerator.s);
    return { n: divRoundHalfAway(num, den), s: scale };
}

/** `base^exponent` for a whole exponent ≥ 0, exact. */
export function powInt(base: Decimal, exponent: number): Decimal {
    if (!Number.isInteger(exponent) || exponent < 0) throw new RangeError("exponent must be a whole number ≥ 0");
    let result: Decimal = { n: 1n, s: 0 };
    let factor = base;
    let remaining = exponent;
    while (remaining > 0) {
        if (remaining % 2 === 1) result = mul(result, factor);
        remaining = Math.floor(remaining / 2);
        if (remaining > 0) factor = mul(factor, factor);
    }
    return result;
}

/** Plain text of a value at exactly `scale` decimals (rounded if it has more). */
export function formatDecimal(a: Decimal, scale: number = normalize(a).s): string {
    const rounded = roundTo(a, scale);
    const negative = rounded.n < 0n;
    const digits = (negative ? -rounded.n : rounded.n).toString().padStart(scale + 1, "0");
    const whole = digits.slice(0, digits.length - scale);
    const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
    return `${negative && rounded.n !== 0n ? "-" : ""}${whole}${fraction}`;
}

/** The value in its shortest exact form, for showing an input back. */
export const exactText = (a: Decimal): string => formatDecimal(normalize(a));

/** Whole calendar days from `from` to `to` (YYYY-MM-DD, UTC, so no clock or DST). */
export function daysBetween(from: string, to: string): number {
    const read = (value: string, label: string) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
        const date = new Date(time);
        // Date.UTC rolls 2026-02-30 over to March: the round trip rejects it.
        if (!match || Number.isNaN(time) || date.toISOString().slice(0, 10) !== value) {
            throw new MethodologyError("invalid_date", `${label}: "${String(value).slice(0, 20)}" is not a calendar date (YYYY-MM-DD).`);
        }
        return time;
    };
    const days = Math.round((read(to, "end_date") - read(from, "start_date")) / 86_400_000);
    if (days < 0) {
        throw new MethodologyError("invalid_date_range", "end_date is before start_date.");
    }
    return days;
}
