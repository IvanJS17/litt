// The closed list of methodology calculations (docs/training.md): simple
// interest, compound interest, index update and proportion. Each takes the
// inputs a person or a document supplied and returns every step with its
// value, so a junior can redo the arithmetic by hand.
//
// LiTT carries no rates or indices. Nothing here looks one up: every figure
// is an input, and the caller records where it came from.
//
// Rounding rule (stated in the annex): the calculation is exact; only the
// published figures are rounded, half away from zero. Money to 2 decimals,
// factors shown to 10. Intermediate values shown rounded are display only.

import {
    MethodologyError,
    add,
    compare,
    daysBetween,
    exactText,
    formatDecimal,
    fromInt,
    isNegative,
    isZero,
    mul,
    parseDecimal,
    powInt,
    ratio,
    roundTo,
    sub,
    type Decimal,
} from "./decimal";
import { methodologyText, type MethodologyText } from "./messages";

export const METHODOLOGY_CALCULATIONS = [
    "simple_interest",
    "compound_interest",
    "index_update",
    "proportion",
] as const;
export type MethodologyCalculation = (typeof METHODOLOGY_CALCULATIONS)[number];

export const MAX_COMPOUND_PERIODS = 600;
const MONEY_SCALE = 2;
const FACTOR_SCALE = 10;
const PERCENT_SCALE = 2;
const RATIO_SCALE = 6;
const HUNDRED = fromInt(100);

export type MethodologyInput = { name: string; label: string; value: string };
export type MethodologyStep = { label: string; expression: string; value: string };
export type MethodologyResult = {
    calculation: MethodologyCalculation;
    title: string;
    inputs: MethodologyInput[];
    formula: string[];
    steps: MethodologyStep[];
    rounding: string;
    /** The figure the calculation exists for. */
    result: { label: string; value: string };
    /** Other published figures (e.g. the interest next to the total). */
    others: { label: string; value: string }[];
};

type Spec = { name: string; label: string };

const INPUT_KEYS: Record<string, string> = {
    principal: "training.criterion.methodology.inputs.principal",
    rate_percent: "training.criterion.methodology.inputs.ratePercent",
    periods: "training.criterion.methodology.inputs.periods",
    start_date: "training.criterion.methodology.inputs.startDate",
    end_date: "training.criterion.methodology.inputs.endDate",
    day_basis: "training.criterion.methodology.inputs.dayBasis",
    amount: "training.criterion.methodology.inputs.amount",
    initial_index: "training.criterion.methodology.inputs.initialIndex",
    final_index: "training.criterion.methodology.inputs.finalIndex",
    numerator: "training.criterion.methodology.inputs.numerator",
    denominator: "training.criterion.methodology.inputs.denominator",
};

const NAMES: Record<MethodologyCalculation, string[]> = {
    simple_interest: ["principal", "rate_percent", "periods", "start_date", "end_date", "day_basis"],
    compound_interest: ["principal", "rate_percent", "periods"],
    index_update: ["amount", "initial_index", "final_index"],
    proportion: ["numerator", "denominator"],
};

export const methodologyInputNames = (calculation: MethodologyCalculation): readonly string[] => NAMES[calculation];

/** Which inputs a calculation needs; simple interest has two ways to say the time. */
function requiredNames(calculation: MethodologyCalculation, given: Record<string, unknown>): string[] {
    if (calculation === "simple_interest") {
        return "start_date" in given || "end_date" in given || "day_basis" in given
            ? ["principal", "rate_percent", "start_date", "end_date", "day_basis"]
            : ["principal", "rate_percent", "periods"];
    }
    return NAMES[calculation];
}

function money(value: Decimal): string {
    return formatDecimal(value, MONEY_SCALE);
}

// Errors are for the model, in English, and name an input by its technical
// name (the one the tool schema uses), never by its translated label.

/** A money amount: non-negative, at most 2 decimals, so the totals add up to the cent. */
function readMoney(raw: unknown, name: string): Decimal {
    const value = parseDecimal(raw, name);
    if (isNegative(value)) {
        throw new MethodologyError("negative_value", `${name} cannot be negative.`);
    }
    const rounded = roundTo(value, MONEY_SCALE);
    if (compare(rounded, value) !== 0) {
        throw new MethodologyError(
            "too_many_decimals",
            `${name} has more than 2 decimals: give the amount as written in the document.`,
        );
    }
    return rounded;
}

function readNonNegative(raw: unknown, name: string): Decimal {
    const value = parseDecimal(raw, name);
    if (isNegative(value)) {
        throw new MethodologyError("negative_value", `${name} cannot be negative.`);
    }
    return value;
}

function readPositive(raw: unknown, name: string): Decimal {
    const value = readNonNegative(raw, name);
    if (isZero(value)) {
        throw new MethodologyError("zero_value", `${name} must be greater than zero.`);
    }
    return value;
}

/** A percentage written as a number of percent: 12 means 12 %, i.e. 0.12. */
const percentToFraction = (percent: Decimal): Decimal => ({ n: percent.n, s: percent.s + 2 });

function echo(specs: Spec[], values: Record<string, Decimal | string>): MethodologyInput[] {
    return specs.map(({ name, label }) => {
        const value = values[name];
        return { name, label, value: typeof value === "string" ? value : exactText(value) };
    });
}

function specsOf(names: string[], text: MethodologyText): Spec[] {
    return names.map((name) => ({ name, label: text.say(INPUT_KEYS[name]!) }));
}

function roundingMoney(text: MethodologyText): string {
    return text.say("training.criterion.methodology.rounding.money");
}

function simpleInterest(given: Record<string, unknown>, text: MethodologyText): MethodologyResult {
    const { say } = text;
    const principal = readMoney(given.principal, "principal");
    const ratePercent = readNonNegative(given.rate_percent, "rate_percent");
    const rate = percentToFraction(ratePercent);
    const byDates = "start_date" in given;
    const specs = specsOf(requiredNames("simple_interest", given), text);

    if (!byDates) {
        const periods = readNonNegative(given.periods, "periods");
        const exact = mul(mul(principal, rate), periods);
        const interest = roundTo(exact, MONEY_SCALE);
        const total = add(principal, interest);
        return {
            calculation: "simple_interest",
            title: say("training.criterion.methodology.simpleInterest.title"),
            inputs: echo(specs, { principal, rate_percent: ratePercent, periods }),
            formula: [say("training.criterion.methodology.simpleInterest.formula.interest"), say("training.criterion.methodology.simpleInterest.formula.total")],
            steps: [
                { label: say("training.criterion.methodology.shared.ratePerPeriod"), expression: `${exactText(ratePercent)} ÷ 100`, value: exactText(rate) },
                {
                    label: say("training.criterion.methodology.simpleInterest.steps.exactInterest"),
                    expression: `${money(principal)} × ${exactText(rate)} × ${exactText(periods)}`,
                    value: exactText(exact),
                },
                {
                    label: say("training.criterion.methodology.simpleInterest.steps.roundedInterest"),
                    expression: say("training.criterion.methodology.shared.roundingOf", { value: exactText(exact) }),
                    value: money(interest),
                },
                { label: say("training.criterion.methodology.shared.total"), expression: `${money(principal)} + ${money(interest)}`, value: money(total) },
            ],
            rounding: roundingMoney(text),
            result: { label: say("training.criterion.methodology.shared.interest"), value: money(interest) },
            others: [{ label: say("training.criterion.methodology.shared.totalWithInterest"), value: money(total) }],
        };
    }

    const startDate = String(given.start_date);
    const endDate = String(given.end_date);
    const days = daysBetween(startDate, endDate);
    const basisValue = parseDecimal(given.day_basis, "day_basis");
    if (basisValue.s !== 0 || (basisValue.n !== 360n && basisValue.n !== 365n && basisValue.n !== 366n)) {
        throw new MethodologyError("invalid_day_basis", "day_basis must be 360, 365 or 366.");
    }
    const basis = basisValue;
    const exactNumerator = mul(mul(principal, rate), fromInt(days));
    const interest = ratio(exactNumerator, basis, MONEY_SCALE);
    const total = add(principal, interest);
    return {
        calculation: "simple_interest",
        title: say("training.criterion.methodology.simpleInterestDays.title"),
        inputs: echo(specs, {
            principal,
            rate_percent: ratePercent,
            start_date: text.day(startDate),
            end_date: text.day(endDate),
            day_basis: basis,
        }),
        formula: [
            say("training.criterion.methodology.simpleInterestDays.formula.days"),
            say("training.criterion.methodology.simpleInterestDays.formula.interest"),
            say("training.criterion.methodology.simpleInterest.formula.total"),
        ],
        steps: [
            { label: say("training.criterion.methodology.simpleInterestDays.steps.days"), expression: `${text.day(endDate)} − ${text.day(startDate)}`, value: String(days) },
            { label: say("training.criterion.methodology.simpleInterestDays.steps.annualRate"), expression: `${exactText(ratePercent)} ÷ 100`, value: exactText(rate) },
            {
                label: say("training.criterion.methodology.simpleInterestDays.steps.numerator"),
                expression: `${money(principal)} × ${exactText(rate)} × ${days}`,
                value: exactText(exactNumerator),
            },
            {
                label: say("training.criterion.methodology.simpleInterest.steps.roundedInterest"),
                expression: `${exactText(exactNumerator)} ÷ ${exactText(basis)}`,
                value: money(interest),
            },
            { label: say("training.criterion.methodology.shared.total"), expression: `${money(principal)} + ${money(interest)}`, value: money(total) },
        ],
        rounding: roundingMoney(text),
        result: { label: say("training.criterion.methodology.shared.interest"), value: money(interest) },
        others: [{ label: say("training.criterion.methodology.shared.totalWithInterest"), value: money(total) }],
    };
}

function compoundInterest(given: Record<string, unknown>, text: MethodologyText): MethodologyResult {
    const { say } = text;
    const principal = readMoney(given.principal, "principal");
    const ratePercent = readNonNegative(given.rate_percent, "rate_percent");
    const periods = parseDecimal(given.periods, "periods");
    if (periods.s !== 0 || periods.n < 0n || periods.n > BigInt(MAX_COMPOUND_PERIODS)) {
        throw new MethodologyError(
            "invalid_periods",
            `periods must be a whole number from 0 to ${MAX_COMPOUND_PERIODS}.`,
        );
    }
    const n = Number(periods.n);
    const rate = percentToFraction(ratePercent);
    const growth = add(fromInt(1), rate);
    const factor = powInt(growth, n);
    const amountExact = mul(principal, factor);
    const amount = roundTo(amountExact, MONEY_SCALE);
    const interest = sub(amount, principal);
    const specs = specsOf(requiredNames("compound_interest", given), text);
    return {
        calculation: "compound_interest",
        title: say("training.criterion.methodology.compoundInterest.title"),
        inputs: echo(specs, { principal, rate_percent: ratePercent, periods }),
        formula: [say("training.criterion.methodology.compoundInterest.formula.amount"), say("training.criterion.methodology.compoundInterest.formula.interest")],
        steps: [
            { label: say("training.criterion.methodology.shared.ratePerPeriod"), expression: `${exactText(ratePercent)} ÷ 100`, value: exactText(rate) },
            { label: say("training.criterion.methodology.compoundInterest.steps.growth"), expression: `1 + ${exactText(rate)}`, value: exactText(growth) },
            {
                label: say("training.criterion.methodology.compoundInterest.steps.factor"),
                expression: `${exactText(growth)}^${n}`,
                value: formatDecimal(factor, FACTOR_SCALE),
            },
            {
                label: say("training.criterion.methodology.compoundInterest.steps.finalAmount"),
                expression: `${money(principal)} × ${exactText(growth)}^${n}`,
                value: money(amount),
            },
            { label: say("training.criterion.methodology.shared.interest"), expression: `${money(amount)} − ${money(principal)}`, value: money(interest) },
        ],
        rounding: say("training.criterion.methodology.compoundInterest.rounding", { base: roundingMoney(text) }),
        result: { label: say("training.criterion.methodology.compoundInterest.result"), value: money(amount) },
        others: [{ label: say("training.criterion.methodology.shared.interest"), value: money(interest) }],
    };
}

function indexUpdate(given: Record<string, unknown>, text: MethodologyText): MethodologyResult {
    const { say } = text;
    const amount = readMoney(given.amount, "amount");
    const initial = readPositive(given.initial_index, "initial_index");
    const final = readPositive(given.final_index, "final_index");
    const factor = ratio(final, initial, FACTOR_SCALE);
    const updated = ratio(mul(amount, final), initial, MONEY_SCALE);
    const difference = sub(updated, amount);
    const specs = specsOf(requiredNames("index_update", given), text);
    return {
        calculation: "index_update",
        title: say("training.criterion.methodology.indexUpdate.title"),
        inputs: echo(specs, { amount, initial_index: initial, final_index: final }),
        formula: [say("training.criterion.methodology.indexUpdate.formula.factor"), say("training.criterion.methodology.indexUpdate.formula.updated")],
        steps: [
            {
                label: say("training.criterion.methodology.indexUpdate.steps.factor"),
                expression: `${exactText(final)} ÷ ${exactText(initial)}`,
                value: formatDecimal(factor, FACTOR_SCALE),
            },
            {
                label: say("training.criterion.methodology.indexUpdate.steps.updated"),
                expression: `${money(amount)} × ${exactText(final)} ÷ ${exactText(initial)}`,
                value: money(updated),
            },
            { label: say("training.criterion.methodology.shared.difference"), expression: `${money(updated)} − ${money(amount)}`, value: money(difference) },
        ],
        rounding: say("training.criterion.methodology.indexUpdate.rounding", { base: roundingMoney(text) }),
        result: { label: say("training.criterion.methodology.indexUpdate.result"), value: money(updated) },
        others: [
            { label: say("training.criterion.methodology.indexUpdate.factor"), value: formatDecimal(factor, FACTOR_SCALE) },
            { label: say("training.criterion.methodology.shared.difference"), value: money(difference) },
        ],
    };
}

function proportion(given: Record<string, unknown>, text: MethodologyText): MethodologyResult {
    const { say } = text;
    const numerator = readNonNegative(given.numerator, "numerator");
    const denominator = readPositive(given.denominator, "denominator");
    const quotient = ratio(numerator, denominator, RATIO_SCALE);
    const percent = ratio(mul(numerator, HUNDRED), denominator, PERCENT_SCALE);
    const specs = specsOf(requiredNames("proportion", given), text);
    return {
        calculation: "proportion",
        title: say("training.criterion.methodology.proportion.title"),
        inputs: echo(specs, { numerator, denominator }),
        formula: [say("training.criterion.methodology.proportion.formula.proportion"), say("training.criterion.methodology.proportion.formula.percentage")],
        steps: [
            {
                label: say("training.criterion.methodology.proportion.steps.proportion"),
                expression: `${exactText(numerator)} ÷ ${exactText(denominator)}`,
                value: formatDecimal(quotient, RATIO_SCALE),
            },
            {
                label: say("training.criterion.methodology.proportion.steps.percentage"),
                expression: `${exactText(numerator)} × 100 ÷ ${exactText(denominator)}`,
                value: `${formatDecimal(percent, PERCENT_SCALE)} %`,
            },
        ],
        rounding: say("training.criterion.methodology.proportion.rounding"),
        result: { label: say("training.criterion.methodology.proportion.result"), value: `${formatDecimal(percent, PERCENT_SCALE)} %` },
        others: [{ label: say("training.criterion.methodology.proportion.proportion"), value: formatDecimal(quotient, RATIO_SCALE) }],
    };
}

/**
 * Runs a calculation on the given inputs (name → text). Missing, unknown or
 * malformed inputs raise a MethodologyError whose message the model can read
 * and fix; it never carries text from a document. The result is written in the
 * language of `text` (es-MX when none is given); the figures are not: they
 * carry no thousands separators in any language, so they mean one thing.
 */
export function calculate(
    calculation: MethodologyCalculation,
    given: Record<string, unknown>,
    text: MethodologyText = methodologyText(),
): MethodologyResult {
    const allowed = new Set(NAMES[calculation]);
    for (const name of Object.keys(given)) {
        if (!allowed.has(name)) {
            throw new MethodologyError("unknown_input", `"${name.slice(0, 40)}" is not an input of ${calculation}. Inputs: ${NAMES[calculation].join(", ")}.`);
        }
    }
    if (calculation === "simple_interest" && "periods" in given && "start_date" in given) {
        throw new MethodologyError("conflicting_inputs", "Give either periods or start_date, end_date and day_basis, not both.");
    }
    for (const name of requiredNames(calculation, given)) {
        if (given[name] === undefined || given[name] === null || given[name] === "") {
            throw new MethodologyError("missing_input", `Missing input "${name}" for ${calculation}.`);
        }
    }
    switch (calculation) {
        case "simple_interest":
            return simpleInterest(given, text);
        case "compound_interest":
            return compoundInterest(given, text);
        case "index_update":
            return indexUpdate(given, text);
        case "proportion":
            return proportion(given, text);
    }
}
