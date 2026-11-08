// compute_methodology (docs/training.md): the tool a junior's turn is given so
// the model never does legal-financial arithmetic in prose. The server
// calculates with exact decimals and returns every step; the model reports
// them. It runs in this process and calls no model.
//
// It is offered only when the training plan says so (lib/trainingTurn), and
// it is never a permission: it reads what the person's turn already reaches.

import {
    METHODOLOGY_CALCULATIONS,
    MethodologyError,
    buildAnnex,
    calculate,
    describeSource,
    type Annex,
    type InputSource,
    type MethodologyCalculation,
} from "../../../../lib/methodology";
import { locateQuote } from "../verifyCitations";

export const METHODOLOGY_TOOL_NAME = "compute_methodology";

const MAX_INPUTS = 8;
const MAX_QUOTE_CHARS = 600;
const MAX_BASIS_CHARS = 500;

export const METHODOLOGY_TOOL = {
    type: "function",
    function: {
        name: METHODOLOGY_TOOL_NAME,
        description:
            "Calculate a legal-financial figure with exact decimal arithmetic and return every step. Use it for simple interest, compound interest, index-factor updates and proportions or percentages; never do that arithmetic yourself. LiTT holds no rates or indices: each input comes from a document (give a verbatim quote) or from the user. Returns the inputs with their sources, the formula, each step, the rounding rule and the result, and by default creates a Word annex with the same content.",
        parameters: {
            type: "object",
            properties: {
                calculation: {
                    type: "string",
                    enum: [...METHODOLOGY_CALCULATIONS],
                    description:
                        "simple_interest: inputs principal, rate_percent (per period) and periods, or principal, rate_percent (annual), start_date, end_date (YYYY-MM-DD) and day_basis (360, 365 or 366). compound_interest: principal, rate_percent (per period), periods (whole number). index_update: amount, initial_index, final_index. proportion: numerator, denominator.",
                },
                inputs: {
                    type: "array",
                    maxItems: MAX_INPUTS,
                    description:
                        "Every input of the calculation. Write every value as a string holding a plain decimal with a point, no thousands separators or symbols (a rate of 12.5 % is \"12.5\"). A JSON number is rejected unless it is a safe integer.",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            value: {
                                type: "string",
                                description: 'The value as text: a plain decimal such as "1000.50". Never a JSON number.',
                            },
                            source: {
                                type: "object",
                                description:
                                    'Where the value comes from: {"kind":"document","doc_id":"doc-0","quote":"exact text of the document"} or {"kind":"person"} for a figure the user gave. Omit it if there is none: the annex will say so.',
                                properties: {
                                    kind: { type: "string", enum: ["document", "person"] },
                                    doc_id: { type: "string" },
                                    quote: { type: "string", maxLength: MAX_QUOTE_CHARS },
                                },
                                required: ["kind"],
                            },
                        },
                        required: ["name", "value"],
                    },
                },
                basis: {
                    type: "string",
                    maxLength: MAX_BASIS_CHARS,
                    description:
                        "Optional legal basis for the calculation as the user or a document states it. It is shown in the annex marked unverified unless a verified quote names the same reference. Never invent one.",
                },
                annex: {
                    type: "boolean",
                    description: "Create the Word annex (default true).",
                },
            },
            required: ["calculation", "inputs"],
            additionalProperties: false,
        },
    },
};

export const METHODOLOGY_SYSTEM_PROMPT = `METHODOLOGY CALCULATIONS:
You never do interest, index-update or percentage arithmetic yourself. Call compute_methodology and report its steps and result exactly as returned; do not recompute or round them again.
LiTT carries no rates or indices. Take each from a document (pass a verbatim quote and its doc_id) or from what the user wrote (source kind "person"). If a figure has no source, say so plainly and leave the source out: the annex will read "Sin fuente".
Do not cite an article, thesis or registry number as the basis of a calculation unless it appears in a document you read; the annex marks any other as unverified.
The result is arithmetic support for the user to review and reproduce. Do not present it as legal advice or as an authority.`;

type RawInput = { name?: unknown; value?: unknown; source?: unknown };

export type MethodologyDeps = {
    /** Text of a document of this turn, or null when the label is unknown. */
    readDocument: (docId: string) => Promise<{ filename: string; text: string } | null>;
    now: () => Date;
    /** Who the annex is generated for. */
    generatedFor: string;
};

export type MethodologyOutcome =
    | {
          ok: true;
          payload: Record<string, unknown>;
          annex: Annex;
          /** The annex was asked for (default); the caller decides whether it may be written. */
          wantsAnnex: boolean;
      }
    | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

async function resolveSource(raw: unknown, deps: MethodologyDeps): Promise<InputSource> {
    if (!isRecord(raw)) return { status: "none" };
    if (raw.kind === "person") return { status: "person" };
    if (raw.kind !== "document") return { status: "none" };
    const docId = typeof raw.doc_id === "string" ? raw.doc_id.trim() : "";
    const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
    const doc = docId ? await deps.readDocument(docId) : null;
    if (!doc || !quote || quote.length > MAX_QUOTE_CHARS) {
        return { status: "document_unverified", filename: doc?.filename ?? null };
    }
    const located = locateQuote(doc.text, quote);
    return located
        ? { status: "document_verified", filename: doc.filename, excerpt: located.excerpt }
        : { status: "document_unverified", filename: doc.filename };
}

export async function runMethodology(args: Record<string, unknown>, deps: MethodologyDeps): Promise<MethodologyOutcome> {
    const calculation = args.calculation;
    if (typeof calculation !== "string" || !(METHODOLOGY_CALCULATIONS as readonly string[]).includes(calculation)) {
        return { ok: false, error: `calculation must be one of: ${METHODOLOGY_CALCULATIONS.join(", ")}.` };
    }
    if (!Array.isArray(args.inputs) || args.inputs.length === 0 || args.inputs.length > MAX_INPUTS) {
        return { ok: false, error: `inputs must list 1 to ${MAX_INPUTS} items of {name, value, source?}.` };
    }
    const values: Record<string, unknown> = {};
    const rawSources: Record<string, unknown> = {};
    for (const item of args.inputs as RawInput[]) {
        if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) {
            return { ok: false, error: "Every input needs a name and a value." };
        }
        const name = item.name.trim();
        if (name in values) return { ok: false, error: `Input "${name.slice(0, 40)}" is repeated.` };
        values[name] = typeof item.value === "number" ? item.value : typeof item.value === "string" ? item.value.trim() : item.value;
        rawSources[name] = item.source;
    }
    let result;
    try {
        result = calculate(calculation as MethodologyCalculation, values);
    } catch (error) {
        if (error instanceof MethodologyError) return { ok: false, error: error.message };
        throw error;
    }
    const sources: Record<string, InputSource> = {};
    for (const input of result.inputs) sources[input.name] = await resolveSource(rawSources[input.name], deps);
    const basis = typeof args.basis === "string" ? args.basis.trim().slice(0, MAX_BASIS_CHARS) : null;
    const annex = buildAnnex(result, { sources, basis, generatedAt: deps.now(), generatedFor: deps.generatedFor });
    return {
        ok: true,
        wantsAnnex: args.annex !== false,
        annex,
        payload: {
            calculation: result.calculation,
            title: result.title,
            inputs: result.inputs.map((input) => ({
                label: input.label,
                value: input.value,
                source: describeSource(sources[input.name]),
            })),
            formula: result.formula,
            steps: result.steps,
            rounding: result.rounding,
            result: result.result,
            others: result.others,
        },
    };
}
