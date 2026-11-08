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

const LABELS: Record<string, string> = {
    principal: "Capital",
    rate_percent: "Tasa (%)",
    periods: "Número de periodos",
    start_date: "Fecha inicial",
    end_date: "Fecha final",
    day_basis: "Base de días del año",
    amount: "Monto a actualizar",
    initial_index: "Índice inicial",
    final_index: "Índice final",
    numerator: "Parte (numerador)",
    denominator: "Total (denominador)",
};

const NAMES: Record<MethodologyCalculation, string[]> = {
    simple_interest: ["principal", "rate_percent", "periods", "start_date", "end_date", "day_basis"],
    compound_interest: ["principal", "rate_percent", "periods"],
    index_update: ["amount", "initial_index", "final_index"],
    proportion: ["numerator", "denominator"],
};

export const methodologyInputNames = (calculation: MethodologyCalculation): readonly string[] => NAMES[calculation];
export const methodologyInputLabel = (name: string): string => LABELS[name] ?? name;

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

/** A money amount: non-negative, at most 2 decimals, so the totals add up to the cent. */
function readMoney(raw: unknown, name: string): Decimal {
    const value = parseDecimal(raw, methodologyInputLabel(name));
    if (isNegative(value)) {
        throw new MethodologyError("negative_value", `${methodologyInputLabel(name)} cannot be negative.`);
    }
    const rounded = roundTo(value, MONEY_SCALE);
    if (compare(rounded, value) !== 0) {
        throw new MethodologyError(
            "too_many_decimals",
            `${methodologyInputLabel(name)} has more than 2 decimals: give the amount as written in the document.`,
        );
    }
    return rounded;
}

function readNonNegative(raw: unknown, name: string): Decimal {
    const value = parseDecimal(raw, methodologyInputLabel(name));
    if (isNegative(value)) {
        throw new MethodologyError("negative_value", `${methodologyInputLabel(name)} cannot be negative.`);
    }
    return value;
}

function readPositive(raw: unknown, name: string): Decimal {
    const value = readNonNegative(raw, name);
    if (isZero(value)) {
        throw new MethodologyError("zero_value", `${methodologyInputLabel(name)} must be greater than zero.`);
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

function simpleInterest(given: Record<string, unknown>): MethodologyResult {
    const principal = readMoney(given.principal, "principal");
    const ratePercent = readNonNegative(given.rate_percent, "rate_percent");
    const rate = percentToFraction(ratePercent);
    const byDates = "start_date" in given;
    const names = requiredNames("simple_interest", given);
    const specs = names.map((name) => ({ name, label: methodologyInputLabel(name) }));

    if (!byDates) {
        const periods = readNonNegative(given.periods, "periods");
        const exact = mul(mul(principal, rate), periods);
        const interest = roundTo(exact, MONEY_SCALE);
        const total = add(principal, interest);
        return {
            calculation: "simple_interest",
            title: "Interés simple",
            inputs: echo(specs, { principal, rate_percent: ratePercent, periods }),
            formula: ["I = C × (T ÷ 100) × n", "Total = C + I"],
            steps: [
                { label: "Tasa por periodo como fracción", expression: `${exactText(ratePercent)} ÷ 100`, value: exactText(rate) },
                {
                    label: "Interés exacto",
                    expression: `${money(principal)} × ${exactText(rate)} × ${exactText(periods)}`,
                    value: exactText(exact),
                },
                { label: "Interés redondeado a centavos", expression: `redondeo de ${exactText(exact)}`, value: money(interest) },
                { label: "Total", expression: `${money(principal)} + ${money(interest)}`, value: money(total) },
            ],
            rounding: ROUNDING_MONEY,
            result: { label: "Interés", value: money(interest) },
            others: [{ label: "Total (capital + interés)", value: money(total) }],
        };
    }

    const startDate = String(given.start_date);
    const endDate = String(given.end_date);
    const days = daysBetween(startDate, endDate);
    const basisValue = parseDecimal(given.day_basis, methodologyInputLabel("day_basis"));
    if (basisValue.s !== 0 || (basisValue.n !== 360n && basisValue.n !== 365n && basisValue.n !== 366n)) {
        throw new MethodologyError("invalid_day_basis", "day_basis must be 360, 365 or 366.");
    }
    const basis = basisValue;
    const exactNumerator = mul(mul(principal, rate), fromInt(days));
    const interest = ratio(exactNumerator, basis, MONEY_SCALE);
    const total = add(principal, interest);
    return {
        calculation: "simple_interest",
        title: "Interés simple por días",
        inputs: echo(specs, {
            principal,
            rate_percent: ratePercent,
            start_date: startDate,
            end_date: endDate,
            day_basis: basis,
        }),
        formula: ["Días = fecha final − fecha inicial", "I = C × (T ÷ 100) × Días ÷ Base", "Total = C + I"],
        steps: [
            { label: "Días naturales", expression: `${endDate} − ${startDate}`, value: String(days) },
            { label: "Tasa anual como fracción", expression: `${exactText(ratePercent)} ÷ 100`, value: exactText(rate) },
            {
                label: "Numerador exacto",
                expression: `${money(principal)} × ${exactText(rate)} × ${days}`,
                value: exactText(exactNumerator),
            },
            {
                label: "Interés redondeado a centavos",
                expression: `${exactText(exactNumerator)} ÷ ${exactText(basis)}`,
                value: money(interest),
            },
            { label: "Total", expression: `${money(principal)} + ${money(interest)}`, value: money(total) },
        ],
        rounding: ROUNDING_MONEY,
        result: { label: "Interés", value: money(interest) },
        others: [{ label: "Total (capital + interés)", value: money(total) }],
    };
}

function compoundInterest(given: Record<string, unknown>): MethodologyResult {
    const principal = readMoney(given.principal, "principal");
    const ratePercent = readNonNegative(given.rate_percent, "rate_percent");
    const periods = parseDecimal(given.periods, methodologyInputLabel("periods"));
    if (periods.s !== 0 || periods.n < 0n || periods.n > BigInt(MAX_COMPOUND_PERIODS)) {
        throw new MethodologyError(
            "invalid_periods",
            `Número de periodos must be a whole number from 0 to ${MAX_COMPOUND_PERIODS}.`,
        );
    }
    const n = Number(periods.n);
    const rate = percentToFraction(ratePercent);
    const growth = add(fromInt(1), rate);
    const factor = powInt(growth, n);
    const amountExact = mul(principal, factor);
    const amount = roundTo(amountExact, MONEY_SCALE);
    const interest = sub(amount, principal);
    const specs = requiredNames("compound_interest", given).map((name) => ({ name, label: methodologyInputLabel(name) }));
    return {
        calculation: "compound_interest",
        title: "Interés compuesto",
        inputs: echo(specs, { principal, rate_percent: ratePercent, periods }),
        formula: ["M = C × (1 + T ÷ 100)^n", "I = M − C"],
        steps: [
            { label: "Tasa por periodo como fracción", expression: `${exactText(ratePercent)} ÷ 100`, value: exactText(rate) },
            { label: "Factor de crecimiento por periodo", expression: `1 + ${exactText(rate)}`, value: exactText(growth) },
            {
                label: "Factor acumulado (mostrado a 10 decimales)",
                expression: `${exactText(growth)}^${n}`,
                value: formatDecimal(factor, FACTOR_SCALE),
            },
            {
                label: "Monto final redondeado a centavos",
                expression: `${money(principal)} × ${exactText(growth)}^${n}`,
                value: money(amount),
            },
            { label: "Interés", expression: `${money(amount)} − ${money(principal)}`, value: money(interest) },
        ],
        rounding: ROUNDING_MONEY + " El factor acumulado se calcula exacto y solo se muestra a 10 decimales.",
        result: { label: "Monto final", value: money(amount) },
        others: [{ label: "Interés", value: money(interest) }],
    };
}

function indexUpdate(given: Record<string, unknown>): MethodologyResult {
    const amount = readMoney(given.amount, "amount");
    const initial = readPositive(given.initial_index, "initial_index");
    const final = readPositive(given.final_index, "final_index");
    const factor = ratio(final, initial, FACTOR_SCALE);
    const updated = ratio(mul(amount, final), initial, MONEY_SCALE);
    const difference = sub(updated, amount);
    const specs = requiredNames("index_update", given).map((name) => ({ name, label: methodologyInputLabel(name) }));
    return {
        calculation: "index_update",
        title: "Actualización por factor de índice",
        inputs: echo(specs, { amount, initial_index: initial, final_index: final }),
        formula: ["Factor = índice final ÷ índice inicial", "Monto actualizado = Monto × Factor"],
        steps: [
            {
                label: "Factor de actualización (mostrado a 10 decimales)",
                expression: `${exactText(final)} ÷ ${exactText(initial)}`,
                value: formatDecimal(factor, FACTOR_SCALE),
            },
            {
                label: "Monto actualizado redondeado a centavos",
                expression: `${money(amount)} × ${exactText(final)} ÷ ${exactText(initial)}`,
                value: money(updated),
            },
            { label: "Diferencia", expression: `${money(updated)} − ${money(amount)}`, value: money(difference) },
        ],
        rounding:
            ROUNDING_MONEY +
            " El monto se calcula con el cociente exacto de los índices, sin redondear el factor; el factor mostrado es solo informativo.",
        result: { label: "Monto actualizado", value: money(updated) },
        others: [
            { label: "Factor de actualización", value: formatDecimal(factor, FACTOR_SCALE) },
            { label: "Diferencia", value: money(difference) },
        ],
    };
}

function proportion(given: Record<string, unknown>): MethodologyResult {
    const numerator = readNonNegative(given.numerator, "numerator");
    const denominator = readPositive(given.denominator, "denominator");
    const quotient = ratio(numerator, denominator, RATIO_SCALE);
    const percent = ratio(mul(numerator, HUNDRED), denominator, PERCENT_SCALE);
    const specs = requiredNames("proportion", given).map((name) => ({ name, label: methodologyInputLabel(name) }));
    return {
        calculation: "proportion",
        title: "Proporción o porcentaje",
        inputs: echo(specs, { numerator, denominator }),
        formula: ["Proporción = parte ÷ total", "Porcentaje = parte ÷ total × 100"],
        steps: [
            {
                label: "Proporción (a 6 decimales)",
                expression: `${exactText(numerator)} ÷ ${exactText(denominator)}`,
                value: formatDecimal(quotient, RATIO_SCALE),
            },
            {
                label: "Porcentaje redondeado a 2 decimales",
                expression: `${exactText(numerator)} × 100 ÷ ${exactText(denominator)}`,
                value: `${formatDecimal(percent, PERCENT_SCALE)} %`,
            },
        ],
        rounding:
            "El porcentaje se calcula con el cociente exacto y se redondea a 2 decimales, mitad hacia arriba (en valor absoluto). La proporción se muestra a 6 decimales.",
        result: { label: "Porcentaje", value: `${formatDecimal(percent, PERCENT_SCALE)} %` },
        others: [{ label: "Proporción", value: formatDecimal(quotient, RATIO_SCALE) }],
    };
}

const ROUNDING_MONEY =
    "La cuenta es exacta; solo se redondean las cifras publicadas, a centavos (2 decimales), mitad hacia arriba (en valor absoluto).";

/**
 * Runs a calculation on the given inputs (name → text). Missing, unknown or
 * malformed inputs raise a MethodologyError whose message the model can read
 * and fix; it never carries text from a document.
 */
export function calculate(calculation: MethodologyCalculation, given: Record<string, unknown>): MethodologyResult {
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
            return simpleInterest(given);
        case "compound_interest":
            return compoundInterest(given);
        case "index_update":
            return indexUpdate(given);
        case "proportion":
            return proportion(given);
    }
}
