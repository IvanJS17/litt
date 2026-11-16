// What the citation support check reads for each citation of an answer: the
// sentence that carries the [n] marker, the quoted text, and the text around
// the quote in the document (the pilot's state, {afirmacion, cita, contexto}).
// Pure string work over text the server already holds; nothing leaves here.
import type { SupportState } from "./typesafe";

/** A citation that can be checked: every quote was found in the document. */
export type CitationSupportInput = {
    ref: number;
    documentId: string | null;
    versionId: string | null;
    startChar: number | null;
    endChar: number | null;
    state: SupportState;
};

/** At most this many citations of one answer are checked; the rest are skipped. */
export const MAX_CHECKED_CITATIONS = 25;
const MAX_CLAIM_CHARS = 700;
/** The pilot's context: the quote's paragraph, or +/-450 characters around the quote when it is longer. */
const CONTEXT_RADIUS = 450;
/**
 * A technical ceiling, not a legal rule: the pilot's contexts reached about
 * 1,400 characters (mean 796). It keeps a document with no paragraph breaks
 * from going whole to the service, whatever the quote or its paragraph.
 */
export const MAX_CONTEXT_CHARS = 1_400;
const MAX_QUOTE_CHARS = 3_000;
const SEGMENT_SEPARATOR = "\n[...]\n";

const stripMarkers = (text: string) =>
    text
        .replace(/\[\d+\](?:\[\d+\])*/g, "")
        .replace(/\*\*|__/g, "")
        .replace(/\s+/g, " ")
        .trim();

/** The answer's prose: everything before the CITATIONS block. */
export function answerProse(fullText: string, openTag: string): string {
    const open = fullText.indexOf(openTag);
    return open >= 0 ? fullText.slice(0, open) : fullText;
}

/**
 * The sentence (or table row) of the answer that carries marker [ref]. A
 * marker that stands alone after a full stop ("... 30 días. [1]") belongs to
 * the sentence before it. Null when the marker is not in the prose.
 */
export function claimForRef(prose: string, ref: number): string | null {
    const marker = new RegExp(`(?<!\\[)\\[${ref}\\](?!\\])`).exec(prose);
    if (!marker) return null;
    let end = marker.index;
    while (end > 0 && /\s/.test(prose[end - 1])) end -= 1;
    // A table row is the claim as a whole.
    const lineStart = prose.lastIndexOf("\n", marker.index - 1) + 1;
    const lineEndAt = prose.indexOf("\n", marker.index);
    const line = prose.slice(lineStart, lineEndAt < 0 ? prose.length : lineEndAt);
    if (line.trimStart().startsWith("|")) return clip(stripMarkers(line.replace(/\|/g, " ")));
    // Walk back to the previous sentence boundary, skipping the one that ends this sentence.
    let start = end - 1;
    if (start >= 0 && /[.!?;:]/.test(prose[start])) start -= 1;
    while (start >= 0) {
        const char = prose[start];
        if (char === "\n") break;
        if (/[.!?]/.test(char) && /\s/.test(prose[start + 1] ?? " ")) break;
        start -= 1;
    }
    const sentence = stripMarkers(prose.slice(start + 1, end));
    return sentence ? clip(sentence) : null;
}

const clip = (text: string) => (text.length > MAX_CLAIM_CHARS ? text.slice(0, MAX_CLAIM_CHARS) : text);

/** From `at - limit`, the first sentence start (just after a sentence end); that point itself when none. */
function snapBack(source: string, at: number, limit: number): number {
    const target = Math.max(0, at - limit);
    for (let i = target; i < at; i += 1) {
        if (i > 0 && (/[.!?]/.test(source[i - 1]) && /\s/.test(source[i]) || source[i - 1] === "\n")) return i;
    }
    return target;
}

/** From `at + limit`, the last sentence end at or after `at`; that point itself when none. */
function snapForward(source: string, at: number, limit: number): number {
    const target = Math.min(source.length, at + limit);
    for (let i = target; i > at; i -= 1) {
        if (/[.!?]/.test(source[i - 1]) || source[i - 1] === "\n") return i;
    }
    return target;
}

/** The quote's paragraph, or the quote with ~450 characters either side, snapped to sentences; never more than MAX_CONTEXT_CHARS. */
export function contextAround(source: string, start: number, end: number): string {
    const paragraphStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const paragraphEndAt = source.indexOf("\n", end);
    const paragraphEnd = paragraphEndAt < 0 ? source.length : paragraphEndAt;
    if (paragraphEnd - paragraphStart <= MAX_CONTEXT_CHARS)
        return source.slice(paragraphStart, paragraphEnd).trim();
    const from = Math.max(paragraphStart, snapBack(source, start, CONTEXT_RADIUS));
    const to = Math.min(paragraphEnd, snapForward(source, end, CONTEXT_RADIUS));
    const window = source.slice(from, to).trim();
    if (window.length <= MAX_CONTEXT_CHARS) return window;
    // A quote longer than the cap: keep the cap's worth of the quote itself.
    return source.slice(start, start + MAX_CONTEXT_CHARS).trim();
}

/** The contexts of a citation's quotes, joined, within MAX_CONTEXT_CHARS in total (each gets an equal share). */
function capContext(contexts: string[]): string {
    if (!contexts.length) return "";
    const share = Math.floor(
        (MAX_CONTEXT_CHARS - SEGMENT_SEPARATOR.length * (contexts.length - 1)) / contexts.length,
    );
    return contexts
        .map((context) => (context.length > share ? context.slice(0, share) : context))
        .join(SEGMENT_SEPARATOR)
        .slice(0, MAX_CONTEXT_CHARS);
}

type VerifiedQuote = {
    quote: string;
    verification?: {
        verified?: boolean;
        start_char?: number;
        end_char?: number;
        source_excerpt?: string;
    };
};

/**
 * One input per verified document citation of the answer. A citation whose
 * text is not in the document, whose marker is not in the prose or whose
 * document cannot be read is skipped: the text check already flags the first,
 * and there is nothing to ask in the others.
 */
export async function buildCitationSupportInputs(args: {
    prose: string;
    citations: readonly unknown[];
    getSourceText: (docId: string) => Promise<string>;
}): Promise<CitationSupportInput[]> {
    const inputs: CitationSupportInput[] = [];
    const seen = new Set<number>();
    for (const citation of args.citations) {
        if (inputs.length >= MAX_CHECKED_CITATIONS) break;
        const c = citation as Record<string, unknown> | null;
        if (!c || typeof c.ref !== "number" || seen.has(c.ref)) continue;
        const docId = typeof c.doc_id === "string" ? c.doc_id : null;
        const quotes = Array.isArray(c.quotes) ? (c.quotes as VerifiedQuote[]) : [];
        if (!docId || !quotes.length) continue;
        if (!quotes.every((q) => q.verification?.verified && typeof q.verification.start_char === "number" && typeof q.verification.end_char === "number")) continue;
        const claim = claimForRef(args.prose, c.ref);
        if (!claim) continue;
        let source: string;
        try {
            source = await args.getSourceText(docId);
        } catch {
            continue;
        }
        if (!source) continue;
        const spans = quotes.map((q) => ({
            start: q.verification!.start_char as number,
            end: q.verification!.end_char as number,
            text: q.verification!.source_excerpt ?? q.quote,
        }));
        const contexts: string[] = [];
        for (const span of spans) {
            const context = contextAround(source, span.start, span.end);
            if (context && !contexts.some((seenContext) => seenContext.includes(context))) contexts.push(context);
        }
        seen.add(c.ref);
        inputs.push({
            ref: c.ref,
            documentId: typeof c.document_id === "string" ? c.document_id : null,
            versionId: typeof c.version_id === "string" ? c.version_id : null,
            startChar: Math.min(...spans.map((s) => s.start)),
            endChar: Math.max(...spans.map((s) => s.end)),
            state: {
                afirmacion: claim,
                cita: spans.map((s) => s.text).join(SEGMENT_SEPARATOR).slice(0, MAX_QUOTE_CHARS),
                contexto: capContext(contexts),
            },
        });
    }
    return inputs;
}
