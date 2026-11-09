// The methodology annex (docs/training.md): what a calculation used, how it
// was done and what came out, laid out so a junior can redo the arithmetic.
//
// It is a plain description of arithmetic. It carries no legal authority and
// says so; a legal basis is shown only as the person wrote it, marked
// unverified unless a verified source quote names the same reference.

import { legalReferences } from "../legalReferences";
import type { MethodologyResult } from "./calculators";
import { methodologyText, type MethodologyText } from "./messages";

/** Where one input came from, as the server found it. */
export type InputSource =
    | { status: "document_verified"; filename: string; excerpt: string }
    | { status: "document_unverified"; filename: string | null }
    | { status: "person" }
    /** The person was named as the source, but the value is not in their message. */
    | { status: "person_unverified" }
    | { status: "none" };

export type AnnexSection = {
    heading?: string;
    level?: number;
    content?: string;
    table?: { headers: string[]; rows: string[][] };
};

export type Annex = { title: string; sections: AnnexSection[] };

const EXCERPT_LIMIT = 300;

export function describeSource(source: InputSource | undefined, text: MethodologyText = methodologyText()): string {
    const { say } = text;
    if (!source || source.status === "none") return say("training.criterion.methodology.source.none");
    if (source.status === "person") return say("training.criterion.methodology.source.person");
    if (source.status === "person_unverified") return say("training.criterion.methodology.source.personUnverified");
    if (source.status === "document_unverified") {
        return source.filename
            ? say("training.criterion.methodology.source.documentUnverifiedIn", { filename: source.filename })
            : say("training.criterion.methodology.source.documentUnverified");
    }
    const excerpt =
        source.excerpt.length > EXCERPT_LIMIT ? `${source.excerpt.slice(0, EXCERPT_LIMIT)}…` : source.excerpt;
    return say("training.criterion.methodology.source.documentVerified", { filename: source.filename, excerpt });
}

/** Said once, at the end of the annex, in the person's language. */
export const annexDisclaimer = (text: MethodologyText = methodologyText()): string => text.say("training.criterion.methodology.generation.disclaimer");

const normalizeMessage = (text: string): string =>
    text
        .replace(/(?<=\d)[,\u00a0\u202f](?=\d{3}(?!\d))/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase();

/**
 * Is `value` written in the person's message? Spaces are collapsed and the
 * commas of thousands dropped on both sides; a number must not be a piece of a
 * longer one (100 is not in 1000 or 0.100).
 */
export function appearsInMessage(value: string, message: string): boolean {
    const wanted = normalizeMessage(value.trim());
    if (!wanted) return false;
    const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![\\d.])${escaped}(?!\\d|\\.\\d)`).test(normalizeMessage(message));
}

/**
 * Marks a legal basis the model named. It counts as backed only when every
 * reference in it is also named by a verified source quote; otherwise it is
 * shown as unverified, and so is a basis with no reference. The law is the
 * source document, whose file name the annex shows; the mentor judges it.
 */
export function verifyBasis(basis: string, sources: Record<string, InputSource>): "backed" | "unverified" {
    const named = legalReferences(basis);
    if (named.size === 0) return "unverified";
    const quoted = new Set<string>();
    for (const source of Object.values(sources)) {
        if (source.status !== "document_verified") continue;
        for (const reference of legalReferences(source.excerpt)) quoted.add(reference);
    }
    return [...named].every((reference) => quoted.has(reference)) ? "backed" : "unverified";
}

export function buildAnnex(
    result: MethodologyResult,
    context: {
        sources: Record<string, InputSource>;
        basis?: string | null;
        generatedAt: Date;
        /** Who asked for it, as the conversation knows them. */
        generatedFor: string;
        /** The person's language; es-MX when absent. */
        text?: MethodologyText;
    },
): Annex {
    const { sources, basis, generatedAt, generatedFor } = context;
    const text = context.text ?? methodologyText();
    const { say } = text;
    const sections: AnnexSection[] = [
        {
            heading: say("training.criterion.methodology.annex.sections.inputs"),
            level: 1,
            table: {
                headers: [say("training.criterion.methodology.annex.headers.input"), say("training.criterion.methodology.annex.headers.value"), say("training.criterion.methodology.annex.headers.source")],
                rows: result.inputs.map((input) => [input.label, input.value, describeSource(sources[input.name], text)]),
            },
        },
        { heading: say("training.criterion.methodology.annex.sections.formula"), level: 1, content: result.formula.join("\n\n") },
        {
            heading: say("training.criterion.methodology.annex.sections.steps"),
            level: 1,
            table: {
                headers: [say("training.criterion.methodology.annex.headers.step"), say("training.criterion.methodology.annex.headers.operation"), say("training.criterion.methodology.annex.headers.value")],
                rows: result.steps.map((step, index) => [
                    say("training.criterion.methodology.annex.stepNumber", { number: index + 1, label: step.label }),
                    step.expression,
                    step.value,
                ]),
            },
        },
        { heading: say("training.criterion.methodology.annex.sections.rounding"), level: 1, content: result.rounding },
        {
            heading: say("training.criterion.methodology.annex.sections.result"),
            level: 1,
            table: {
                headers: [say("training.criterion.methodology.annex.headers.concept"), say("training.criterion.methodology.annex.headers.value")],
                rows: [[result.result.label, result.result.value], ...result.others.map((o) => [o.label, o.value])],
            },
        },
    ];
    if (basis?.trim()) {
        const status = say(verifyBasis(basis.trim(), sources) === "backed" ? "training.criterion.methodology.basis.backed" : "training.criterion.methodology.basis.unverified");
        sections.push({
            heading: say("training.criterion.methodology.annex.sections.basis"),
            level: 1,
            content: say("training.criterion.methodology.basis.state", { basis: basis.trim(), status }),
        });
    }
    sections.push({
        heading: say("training.criterion.methodology.annex.sections.generation"),
        level: 1,
        content: say("training.criterion.methodology.generation.line", {
            person: generatedFor || say("training.criterion.methodology.generation.anonymous"),
            date: text.today(generatedAt),
            disclaimer: annexDisclaimer(text),
        }),
    });
    return { title: say("training.criterion.methodology.annex.title", { title: result.title }), sections };
}
