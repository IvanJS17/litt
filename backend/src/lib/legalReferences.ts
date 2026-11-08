// Legal references (docs/training.md): which articles, fractions, theses and
// registry numbers a text names, normalized so the same reference written two
// ways compares equal. Used to keep a model's questions from citing a
// reference the input never named.
//
// Extracted from trainingSupervisionAi.ts unchanged, so the criterion layer
// can reuse it without importing the supervision prompts.

//
// Each number of an enumeration («artículos 1949, 2000 y 2001», «registros
// 2021234 y 2021235», «tesis I.3o.C.123 C y I.4o.C.5 C») is a reference of its
// own, and so is each fraction of an article («artículo 27, fracciones II y
// IV», «fracción VII del artículo 123»). A range («1949 a 1951») names every
// number in it; one wider than RANGE_EXPANSION_LIMIT names its two ends and
// the range itself, so a question can cite it only as the input wrote it.

type ReferenceItem = { end: number; key: string; ordinal: number | null; fractions: string[] };
type ItemReader = (text: string, at: number) => ReferenceItem | null;

const RANGE_EXPANSION_LIMIT = 100;
const LIST_SEPARATOR = /\s*,\s*(?:(?:y|e|o|u)\s+)?|\s+(?:y|e|o|u)\s+/y;
const RANGE_SEPARATOR = /\s+(?:a|al|hasta(?:\s+el)?)\s+/y;
const ARTICLE_HEAD = /\bart(?:iculos?|s?\.?)\s*/g;
// «1949», «1o.», «14 bis», «17a».
const ARTICLE_ITEM = /(\d+)(?:o\b|[º°])?\.?(?:\s*(bis|ter|quater)\b|([a-z])\b)?/y;
const FRACTION_WORD = String.raw`(?:fraccion(?:es)?|fracc?\.|fr\.)`;
const FRACTION_AFTER_ARTICLE = new RegExp(String.raw`\s*,?\s*${FRACTION_WORD}\s*`, "y");
const FRACTION_HEAD = new RegExp(String.raw`\b${FRACTION_WORD}\s*`, "g");
const FRACTION_OF_ARTICLE = /\s*,?\s*(?:del?|de\s+los)\s+art(?:iculos?|s?\.?)\s*/y;
const ROMAN_ITEM = /(m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))\b/y;
// «Tesis 1a./J. 12/2020», «jurisprudencia P./J. 5/2019», «tesis I.3o.C.123».
const THESIS_HEAD = /\b(?:tesis|jurisprudencias?)(?:\s+aisladas?)?\s*:?\s*/g;
const THESIS_ITEM = /([a-z0-9][a-z0-9./ -]{0,30}?\d+\/\d{4}|[a-z0-9]+(?:[./-][a-z0-9]+)+)/y;
// The subject letters of an isolated thesis («I.3o.C.123 C»), skipped before a separator.
const THESIS_SUBJECT = /\s+\(?[a-z]{1,2}\)?(?=\s*,|\s+(?:y|e|o|u)\s)/y;
// A jurisprudence id on its own: «1a./J. 12/2020».
const JURISPRUDENCE_ID = /(?<![a-z0-9])((?:\d+[a-z]{0,2}|[a-z]{1,2})\.\s*\/\s*j\.\s*\d+\/\d{4})/g;
const REGISTRY_HEAD = /\bregistros?(?:\s+digital(?:es)?)?\s*(?:no\.?|num\.?|nums\.?|numeros?)?\s*:?\s*/g;
const REGISTRY_ITEM = /(\d{4,})/y;

function sticky(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
    pattern.lastIndex = at;
    return pattern.exec(text);
}

function romanValue(roman: string): number {
    const digits: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
    let total = 0;
    for (let i = 0; i < roman.length; i++) {
        const value = digits[roman[i]];
        total += value < (digits[roman[i + 1]] ?? 0) ? -value : value;
    }
    return total;
}

const readRoman: ItemReader = (text, at) => {
    const match = sticky(ROMAN_ITEM, text, at);
    if (!match || !match[1]) return null;
    const value = romanValue(match[1]);
    return { end: at + match[0].length, key: String(value), ordinal: value, fractions: [] };
};

/** `item ((, | y | a) item)*` from `at`, ranges expanded; a separator not followed by an item is not read. */
function readEnumeration(text: string, at: number, readItem: ItemReader): { items: ReferenceItem[]; end: number } | null {
    const first = readItem(text, at);
    if (!first) return null;
    const items = [first];
    let end = first.end;
    for (;;) {
        const range = sticky(RANGE_SEPARATOR, text, end);
        const separator = range ?? sticky(LIST_SEPARATOR, text, end);
        if (!separator) break;
        const next = readItem(text, end + separator[0].length);
        if (!next) break;
        const from = items[items.length - 1].ordinal;
        if (range && from !== null && next.ordinal !== null && next.ordinal > from) {
            if (next.ordinal - from <= RANGE_EXPANSION_LIMIT)
                for (let n = from + 1; n < next.ordinal; n++)
                    items.push({ end: next.end, key: String(n), ordinal: n, fractions: [] });
            else items.push({ end: next.end, key: `${from}-${next.ordinal}`, ordinal: null, fractions: [] });
        }
        items.push(next);
        end = next.end;
    }
    return { items, end };
}

const readArticle: ItemReader = (text, at) => {
    const match = sticky(ARTICLE_ITEM, text, at);
    if (!match) return null;
    const suffix = match[2] ?? match[3] ?? "";
    let end = at + match[0].length;
    let fractions: string[] = [];
    const intro = sticky(FRACTION_AFTER_ARTICLE, text, end);
    const listed = intro ? readEnumeration(text, end + intro[0].length, readRoman) : null;
    if (listed) {
        fractions = listed.items.map((item) => item.key);
        end = listed.end;
    }
    return { end, key: match[1] + suffix, ordinal: suffix ? null : Number(match[1]), fractions };
};

const readThesis: ItemReader = (text, at) => {
    const match = sticky(THESIS_ITEM, text, at);
    if (!match) return null;
    const end = at + match[0].length;
    const subject = sticky(THESIS_SUBJECT, text, end);
    return { end: end + (subject?.[0].length ?? 0), key: match[1].replace(/\s+/g, ""), ordinal: null, fractions: [] };
};

const readRegistry: ItemReader = (text, at) => {
    const match = sticky(REGISTRY_ITEM, text, at);
    return match ? { end: at + match[0].length, key: match[1], ordinal: Number(match[1]), fractions: [] } : null;
};

/**
 * The legal references a text names (articles and their fractions, theses,
 * registry numbers), one per number of an enumeration, normalized so the
 * same reference written two ways compares equal.
 */
export function legalReferences(text: string): Set<string> {
    const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const found = new Set<string>();
    const listsAfter = (head: RegExp, readItem: ItemReader) =>
        [...plain.matchAll(head)].flatMap(
            (match) => readEnumeration(plain, match.index + match[0].length, readItem)?.items ?? [],
        );
    for (const article of listsAfter(ARTICLE_HEAD, readArticle)) {
        found.add(`art:${article.key}`);
        for (const fraction of article.fractions) found.add(`art:${article.key}:fr:${fraction}`);
    }
    // «la fracción VII del artículo 123»: the article itself is found above.
    for (const head of plain.matchAll(FRACTION_HEAD)) {
        const fractions = readEnumeration(plain, head.index + head[0].length, readRoman);
        const link = fractions && sticky(FRACTION_OF_ARTICLE, plain, fractions.end);
        const article = fractions && link && readArticle(plain, fractions.end + link[0].length);
        if (article) for (const fraction of fractions.items) found.add(`art:${article.key}:fr:${fraction.key}`);
    }
    for (const thesis of listsAfter(THESIS_HEAD, readThesis)) found.add(`tesis:${thesis.key}`);
    for (const match of plain.matchAll(JURISPRUDENCE_ID)) found.add(`tesis:${match[1].replace(/\s+/g, "")}`);
    for (const registry of listsAfter(REGISTRY_HEAD, readRegistry)) found.add(`registro:${registry.key}`);
    return found;
}
