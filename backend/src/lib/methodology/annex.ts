// The methodology annex (docs/training.md): what a calculation used, how it
// was done and what came out, laid out so a junior can redo the arithmetic.
//
// It is a plain description of arithmetic. It carries no legal authority and
// says so; a legal basis is shown only as the person wrote it, marked
// unverified unless a verified source quote names the same reference.

import { legalReferences } from "../legalReferences";
import type { MethodologyResult } from "./calculators";

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

export const NO_SOURCE_TEXT = "Sin fuente";
export const UNVERIFIED_BASIS_TEXT = "sin verificar";
export const ANNEX_DISCLAIMER =
    "Este anexo documenta una operación aritmética con los datos indicados. No es una opinión jurídica ni sustituye la revisión de un abogado. LiTT no aporta tasas ni índices: cada uno proviene de la fuente que se indica.";

const EXCERPT_LIMIT = 300;

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

export function describeSource(source: InputSource | undefined): string {
    if (!source || source.status === "none") return NO_SOURCE_TEXT;
    if (source.status === "person") return "Dato dado por la persona";
    if (source.status === "person_unverified") return "No encontrado en tu mensaje (sin verificar)";
    if (source.status === "document_unverified") {
        return `Cita no localizada${source.filename ? ` en «${source.filename}»` : ""} (sin verificar)`;
    }
    const excerpt =
        source.excerpt.length > EXCERPT_LIMIT ? `${source.excerpt.slice(0, EXCERPT_LIMIT)}…` : source.excerpt;
    return `«${source.filename}»: «${excerpt}» (cita verificada)`;
}

/**
 * Marks a legal basis the model named. It counts as backed only when every
 * reference in it is also named by a verified source quote; otherwise it is
 * shown as unverified. Not recognizing any reference is also unverified.
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
    },
): Annex {
    const { sources, basis, generatedAt, generatedFor } = context;
    const sections: AnnexSection[] = [
        {
            heading: "Datos de origen",
            level: 1,
            table: {
                headers: ["Dato", "Valor", "Fuente"],
                rows: result.inputs.map((input) => [input.label, input.value, describeSource(sources[input.name])]),
            },
        },
        { heading: "Fórmula", level: 1, content: result.formula.join("\n\n") },
        {
            heading: "Pasos",
            level: 1,
            table: {
                headers: ["Paso", "Operación", "Valor"],
                rows: result.steps.map((step, index) => [`${index + 1}. ${step.label}`, step.expression, step.value]),
            },
        },
        { heading: "Regla de redondeo", level: 1, content: result.rounding },
        {
            heading: "Resultado",
            level: 1,
            table: {
                headers: ["Concepto", "Valor"],
                rows: [[result.result.label, result.result.value], ...result.others.map((o) => [o.label, o.value])],
            },
        },
    ];
    if (basis?.trim()) {
        const status = verifyBasis(basis.trim(), sources) === "backed" ? "respaldado por una cita verificada" : UNVERIFIED_BASIS_TEXT;
        sections.push({
            heading: "Fundamento indicado",
            level: 1,
            content: `${basis.trim()}\n\nEstado: ${status}.`,
        });
    }
    sections.push({
        heading: "Generación",
        level: 1,
        content: `Generado en LiTT para ${generatedFor} el ${generatedAt.toISOString().slice(0, 10)} (UTC).\n\n${ANNEX_DISCLAIMER}`,
    });
    return { title: `Anexo de metodología - ${result.title}`, sections };
}
