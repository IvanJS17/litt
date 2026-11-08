// LiTT training, layer 3 (docs/training.md): the structured verdict the
// contrast of a pasante's turn ends with.
//
// The contrast compares the pasante's approach with the answer THE AI gave,
// which can itself be wrong. So what it measures is called a coincidence
// with the answer, "according to the AI contrast", never a hit; the pasante's
// current mentor can overrule it (verdict_source = 'mentor'), and a turn
// whose answer carried an unverified citation does not count at all
// (answer_unverified).
//
// The model ends its answer with up to four labelled lines:
//
//     Veredicto: coincide | parcial | no coincide
//     Fundamento: sólido | débil | equivocado
//     Temas: tema; tema; tema
//     Pregunta: una sola pregunta sobre el fundamento
//
// A text without them is still a valid contrast (notes written before this
// format, or a model that skipped them): the verdict is just null. What the
// model writes is untrusted, so each line is checked here, by the server.

import { legalReferences } from "./legalReferences";

export const TRAINING_VERDICTS = ["coincide", "parcial", "no_coincide"] as const;
export type TrainingVerdict = (typeof TRAINING_VERDICTS)[number];
export type TrainingVerdictSource = "contrast" | "mentor";

export const TRAINING_FOUNDATIONS = ["solid", "weak", "wrong"] as const;
export type TrainingFoundation = (typeof TRAINING_FOUNDATIONS)[number];

/** Bounds shared with the column checks of training_turn_notes. */
export const TRAINING_TOPICS_MAX = 3;
export const TRAINING_TOPIC_MAX_CHARS = 80;
export const TRAINING_FOUNDATION_QUESTION_MAX_CHARS = 500;

export function isTrainingVerdict(value: unknown): value is TrainingVerdict {
    return typeof value === "string" && (TRAINING_VERDICTS as readonly string[]).includes(value);
}

export type ContrastTrailer = {
    /** The contrast without its trailer: what is stored and shown. */
    body: string;
    verdict: TrainingVerdict | null;
    foundation: TrainingFoundation | null;
    /** At most TRAINING_TOPICS_MAX short labels. */
    topics: string[];
    /** The raw question, not yet checked against the input (see acceptFoundationQuestion). */
    question: string | null;
};

const plain = (text: string) =>
    text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

/**
 * `Veredicto: x` with the Markdown marks a model may add around it. A
 * bulleted line is NOT a trailer line: a bullet of «Faltó» may well begin with
 * the word «Fundamento».
 */
const TRAILER_LINE = /^\s*[*_`]*\s*(veredicto|fundamento|temas?|pregunta(?:\s+de\s+fundamento)?)\s*[*_`]*\s*:\s*[*_`]*\s*(.*?)\s*[*_`]*\s*$/i;

function readVerdict(value: string): TrainingVerdict | null {
    const word = plain(value).replace(/[^a-z_ ]/g, " ").replace(/[_\s]+/g, " ").trim();
    if (word === "coincide") return "coincide";
    if (word === "parcial" || word === "coincide parcialmente") return "parcial";
    if (word === "no coincide") return "no_coincide";
    return null;
}

function readFoundation(value: string): TrainingFoundation | null {
    const word = plain(value).replace(/[^a-z ]/g, " ").trim();
    if (word === "solido") return "solid";
    if (word === "debil") return "weak";
    if (word === "equivocado") return "wrong";
    return null;
}

function readTopics(value: string): string[] {
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const raw of value.split(";")) {
        const topic = raw.replace(/\s+/g, " ").replace(/^[-*•\s]+|[.\s]+$/g, "").trim();
        if (!topic || /^nada$/i.test(topic) || [...topic].length > TRAINING_TOPIC_MAX_CHARS) continue;
        const key = plain(topic);
        if (seen.has(key)) continue;
        seen.add(key);
        topics.push(topic);
        if (topics.length === TRAINING_TOPICS_MAX) break;
    }
    return topics;
}

/**
 * Splits a contrast from the labelled lines it ends with. Only the BLOCK AT
 * THE END counts: a «Fundamento: …» inside a bullet of «Coincide» is part of
 * the contrast, not a trailer. The first value of a label wins from the end
 * (the last line the model wrote), a value that does not parse is dropped
 * but its line still leaves the body.
 */
export function parseContrastTrailer(text: string): ContrastTrailer {
    const lines = text.split(/\r?\n/);
    let end = lines.length;
    const found = new Map<string, string>();
    let cut = end;
    for (let i = end - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.trim()) {
            if (found.size > 0) cut = i;
            continue;
        }
        const match = TRAILER_LINE.exec(line);
        if (!match) break;
        const label = plain(match[1]).startsWith("pregunta")
            ? "pregunta"
            : plain(match[1]).startsWith("tema")
              ? "temas"
              : plain(match[1]);
        if (!found.has(label)) found.set(label, match[2]);
        cut = i;
    }
    const body = lines.slice(0, cut).join("\n").trim();
    const question = found.get("pregunta")?.trim() ?? "";
    return {
        body,
        verdict: found.has("veredicto") ? readVerdict(found.get("veredicto")!) : null,
        foundation: found.has("fundamento") ? readFoundation(found.get("fundamento")!) : null,
        topics: found.has("temas") ? readTopics(found.get("temas")!) : [],
        question: question && !/^nada\.?$/i.test(question) ? question : null,
    };
}

/**
 * The question about the basis of an approach whose conclusion matched
 * («¿en qué precepto o hecho se apoya?»). It must be answerable with what the
 * pasante wrote and with the answer they received, so it is dropped when it
 * names a legal reference neither text names (legalReferences): the model
 * would be teaching a reference LiTT cannot show. The verdict stays.
 */
export function acceptFoundationQuestion(
    trailer: Pick<ContrastTrailer, "verdict" | "foundation" | "question">,
    input: { attempt: string; answer: string },
): string | null {
    if (trailer.verdict !== "coincide") return null;
    if (trailer.foundation !== "weak" && trailer.foundation !== "wrong") return null;
    const question = trailer.question?.replace(/\s+/g, " ").trim();
    if (!question || [...question].length > TRAINING_FOUNDATION_QUESTION_MAX_CHARS) return null;
    const allowed = new Set([...legalReferences(input.attempt), ...legalReferences(input.answer)]);
    for (const reference of legalReferences(question)) if (!allowed.has(reference)) return null;
    return question;
}

export type VerdictFields = {
    verdict: TrainingVerdict | null;
    verdict_source?: TrainingVerdictSource | null;
    foundation: TrainingFoundation | null;
};

/**
 * The verdict that counts. The contrast's `coincide` with a `wrong`
 * foundation counts as `parcial` («acertaste por la razón equivocada»): the
 * conclusion matched, the reasoning did not. A mentor's correction counts as
 * written.
 */
export function effectiveVerdict(note: VerdictFields): TrainingVerdict | null {
    if (note.verdict === "coincide" && note.verdict_source !== "mentor" && note.foundation === "wrong")
        return "parcial";
    return note.verdict;
}

/** Whether the note is the «right conclusion, wrong reason» case. */
export function rightForTheWrongReason(note: VerdictFields): boolean {
    return note.verdict === "coincide" && note.verdict_source !== "mentor" && note.foundation === "wrong";
}
