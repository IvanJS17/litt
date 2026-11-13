// The document types Split sorts pages into (layer 7, docs/document-split.md).
// Product data, not interface text: the built-in list is Spanish on purpose and
// is never translated. Pure, so the parser-free modules (user, orgs, documents)
// share one definition and one validation.

export type SplitClass = { name: string; description: string; identifier?: string };

/** LandingAI Split accepts at most this many types per call. */
export const SPLIT_MAX_CLASSES = 19;
export const SPLIT_NAME_MAX = 80;
export const SPLIT_DESCRIPTION_MAX = 800;
export const SPLIT_IDENTIFIER_MAX = 80;

/** The Mexican case-file list, tried on a real 34-page file (16 of 17 groups right). */
export const DEFAULT_SPLIT_CLASSES: readonly SplitClass[] = [
    {
        name: "Carátula del instrumento",
        description:
            "Portada o primera hoja de un instrumento notarial mexicano que resume qué contiene (por ejemplo 'Instrumento público que contiene la protocolización de...'), con número de escritura, volumen y fecha.",
    },
    {
        name: "Instrumento notarial",
        description:
            "Cuerpo de la escritura o póliza redactado por el notario: proemio, antecedentes (incluida la transcripción de la escritura constitutiva y sus estatutos), declaraciones, cláusulas, personalidad, generales de los comparecientes, certificaciones y autorización del notario.",
    },
    {
        name: "Acta protocolizada",
        description:
            "El acta o documento privado que el notario protocoliza y transcribe o agrega: acta de asamblea de accionistas o socios (lista de asistencia, orden del día, resoluciones, firmas del presidente y secretario), acta de consejo, contrato privado.",
    },
    {
        name: "Constancia de situación fiscal",
        description:
            "Constancia de situación fiscal o cédula de identificación fiscal del SAT, con RFC, CURP, idCIF, régimen, domicilio fiscal y actividades económicas.",
        identifier: "RFC del contribuyente",
    },
    {
        name: "Credencial para votar (INE)",
        description: "Credencial para votar del INE o IFE, anverso y reverso.",
        identifier: "Nombre del titular",
    },
    {
        name: "Pasaporte u otra identificación",
        description: "Pasaporte, cédula profesional, licencia u otra identificación oficial distinta de la credencial del INE.",
        identifier: "Nombre del titular",
    },
    {
        name: "Boleta del Registro Público de Comercio",
        description:
            "Boleta o folio de inscripción en el Registro Público de Comercio o de la Propiedad, con número de folio mercantil electrónico.",
    },
    {
        name: "Poder o documento de personalidad",
        description:
            "Documento que acredita la personalidad o representación de un compareciente: poder notarial, nombramiento, acta previa, testimonio de otra escritura.",
    },
    {
        name: "Comprobante de domicilio",
        description: "Recibo de luz, agua, teléfono, predial o estado de cuenta usado como comprobante de domicilio.",
    },
    {
        name: "Acta del Registro Civil",
        description: "Acta de nacimiento, matrimonio o defunción.",
    },
    {
        name: "Aviso o trámite notarial",
        description:
            "Avisos, solicitudes o acuses de trámites del notario ante autoridades (SAT, Secretaría de Economía, Relaciones Exteriores, RPP), notas complementarias.",
    },
    {
        name: "Hoja en blanco o sello",
        description: "Página sin contenido útil: en blanco, solo con sello, 'sin texto' o inutilizada.",
    },
];

export type SplitClassesCheck = { ok: true; classes: SplitClass[] } | { ok: false; detail: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/**
 * A list as a person or a firm sends it, checked and trimmed. Refused as a
 * whole (never trimmed to fit): at least one and at most 19 types, each with a
 * name and a description, no two with the same name, `uncategorized` reserved
 * (it is what Split calls a page that fits none).
 */
export function normalizeSplitClasses(input: unknown): SplitClassesCheck {
    if (!Array.isArray(input) || input.length === 0) return { ok: false, detail: "classes must be a non-empty array" };
    if (input.length > SPLIT_MAX_CLASSES) return { ok: false, detail: `At most ${SPLIT_MAX_CLASSES} types are allowed` };
    const classes: SplitClass[] = [];
    const seen = new Set<string>();
    for (const item of input) {
        if (!isRecord(item)) return { ok: false, detail: "Each type must be an object" };
        const name = clean(item.name);
        const description = clean(item.description);
        const identifier = clean(item.identifier);
        if (!name || name.length > SPLIT_NAME_MAX) return { ok: false, detail: `Each type needs a name of up to ${SPLIT_NAME_MAX} characters` };
        if (!description || description.length > SPLIT_DESCRIPTION_MAX)
            return { ok: false, detail: `Each type needs a description of up to ${SPLIT_DESCRIPTION_MAX} characters` };
        if (identifier.length > SPLIT_IDENTIFIER_MAX) return { ok: false, detail: `An identifier is at most ${SPLIT_IDENTIFIER_MAX} characters` };
        const key = name.toLowerCase();
        if (key === "uncategorized" || seen.has(key)) return { ok: false, detail: "Type names must be unique" };
        seen.add(key);
        classes.push(identifier ? { name, description, identifier } : { name, description });
    }
    return { ok: true, classes };
}

/** A stored value, or null when it is empty or no longer valid (a stale row never breaks a split). */
export function readStoredSplitClasses(stored: unknown): SplitClass[] | null {
    const checked = normalizeSplitClasses(stored);
    return checked.ok ? checked.classes : null;
}

/** What a settings screen needs: the list in force for this scope, whether it is the scope's own, and the built-in list to restore. */
export type SplitClassesSettings = {
    classes: SplitClass[];
    /** True when this person or firm saved a list of its own. */
    custom: boolean;
    defaults: SplitClass[];
    max: number;
};

export function splitClassesSettings(stored: SplitClass[] | null): SplitClassesSettings {
    const defaults = DEFAULT_SPLIT_CLASSES.map((c) => ({ ...c }));
    return { classes: stored ?? defaults.map((c) => ({ ...c })), custom: stored !== null, defaults, max: SPLIT_MAX_CLASSES };
}

/** A PUT body: `{ classes: [...] }` saves a list, `{ classes: null }` restores the built-in one. */
export function parseSplitClassesBody(body: unknown): { ok: true; classes: SplitClass[] | null } | { ok: false; detail: string } {
    if (!isRecord(body) || !("classes" in body)) return { ok: false, detail: "Expected { classes: [...] | null }" };
    if (body.classes === null) return { ok: true, classes: null };
    return normalizeSplitClasses(body.classes);
}
