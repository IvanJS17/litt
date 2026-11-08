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
// Every pattern read through `sticky` starts with `^`: it is matched against the text from `at` on.
const LIST_SEPARATOR = /^(?:\s*,\s*(?:(?:y|e|o|u)\s+)?|\s+(?:y|e|o|u)\s+)/;
const RANGE_SEPARATOR = /^\s+(?:a|al|hasta(?:\s+el)?)\s+/;
const GAP = /^\s+/;
const CONSTITUTIONAL_ADJECTIVE = /^\s+constitucional(?:es)?\b/;
const DIRECT_LAW = /^\s+\(?([a-z]{2,8})\b/;
const ARTICLE_HEAD = /\bart(?:iculos?|s?\.?)\s*/g;
// «1949», «1o.», «14 bis», «17a».
const ARTICLE_ITEM = /^(\d+)(?:o\b|[º°])?\.?(?:\s*(bis|ter|quater)\b|([a-z])\b)?/;
const FRACTION_WORD = String.raw`(?:fraccion(?:es)?|fracc?\.|fr\.)`;
const FRACTION_AFTER_ARTICLE = new RegExp(String.raw`^\s*(?:,\s*)?${FRACTION_WORD}\s*`);
const FRACTION_HEAD = new RegExp(String.raw`\b${FRACTION_WORD}\s*`, "g");
const FRACTION_OF_ARTICLE = /^\s*(?:,\s*)?(?:del?|de\s+los)\s+art(?:iculos?|s?\.?)\s*/;
const ROMAN_ITEM = /^(m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))\b/;
// «Tesis 1a./J. 12/2020», «jurisprudencia P./J. 5/2019», «tesis I.3o.C.123».
const THESIS_HEAD = /\b(?:tesis|jurisprudencias?)\s*(?:(?<=\s)aisladas?\s*)?(?::\s*)?/g;
const THESIS_ITEM = /^([a-z0-9][a-z0-9./ -]{0,30}?\d+\/\d{4}|[a-z0-9]+(?:[./-][a-z0-9]+)+)/;
// The subject letters of an isolated thesis («I.3o.C.123 C»), skipped before a separator.
const THESIS_SUBJECT = /^\s+\(?[a-z]{1,2}\)?(?=\s*,|\s+(?:y|e|o|u)\s)/;
// A jurisprudence id on its own: «1a./J. 12/2020».
const JURISPRUDENCE_ID = /(?<![a-z0-9])((?:\d+[a-z]{0,2}|[a-z]{1,2})\.\s*\/\s*j\.\s*\d+\/\d{4})/g;
const REGISTRY_HEAD = /\bregistros?\s*(?:(?<=\s)digital(?:es)?\s*)?(?:(?:no\.?|num\.?|nums\.?|numeros?)\s*)?(?::\s*)?/g;
const REGISTRY_ITEM = /^(\d{4,})/;

/**
 * `pattern` (anchored with `^`) matched against `text` from `at` on, never from a later
 * position; `match[0].length` is the length read from `at`. A pattern that only a sticky
 * flag anchored would be tried from every position of a long run of blanks as far as a
 * static analysis can tell; `^` says it is not.
 */
export function sticky(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
    if (!pattern.source.startsWith("^") || pattern.global || pattern.sticky)
        throw new Error(`sticky(): the pattern must start with ^ and carry no g or y flag: ${pattern}`);
    return pattern.exec(text.slice(at));
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

// ---------------------------------------------------------------------------
// Strict comparison: article references together with the law they belong to.
//
// `legalReferences` compares numbers only («art:5» is «art:5» in any law). That
// is enough to keep a question from naming a number the input never named, but
// not to say a passage SHOWS a reference: article 5 of one law is not article 5
// of another. `lawReferences` therefore appends the normalized law to each
// article key («art:5@ley federal trabajo»); an article whose law cannot be
// established ends in «@?» and never matches anything, itself included. Theses
// and registry numbers identify themselves and keep their plain key.
// ---------------------------------------------------------------------------

/** The law of an article whose law cannot be established. */
export const UNKNOWN_LAW = "?";

const LAW_STOPWORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "para", "al"]);
const LAW_HEADS = new Set(["ley", "leyes", "codigo", "constitucion", "reglamento", "decreto", "estatuto", "convenio", "tratado"]);
const LAW_PHRASE_MAX_WORDS = 10;
// Characters of text tokenized after an article to read the law's name (widened when the name goes on).
const LAW_WINDOW_CHARS = 400;
// Common abbreviations and aliases, to the law they name (as written in full).
const LAW_ALIASES: Record<string, string> = {
    cpeum: "constitucion politica de los estados unidos mexicanos",
    cpem: "constitucion politica de los estados unidos mexicanos",
    constitucion: "constitucion politica de los estados unidos mexicanos",
    "constitucion federal": "constitucion politica de los estados unidos mexicanos",
    "carta magna": "constitucion politica de los estados unidos mexicanos",
    lft: "ley federal del trabajo",
    ccf: "codigo civil federal",
    cpf: "codigo penal federal",
    cff: "codigo fiscal de la federacion",
    cfpc: "codigo federal de procedimientos civiles",
    cnpcf: "codigo nacional de procedimientos civiles y familiares",
    cnpp: "codigo nacional de procedimientos penales",
    ccom: "codigo de comercio",
    lisr: "ley del impuesto sobre la renta",
    liva: "ley del impuesto al valor agregado",
    lgsm: "ley general de sociedades mercantiles",
    lgtoc: "ley general de titulos y operaciones de credito",
    lss: "ley del seguro social",
    lfpc: "ley federal de proteccion al consumidor",
    lfppi: "ley federal de proteccion a la propiedad industrial",
    lam: "ley de amparo",
};

/** The words of a law's name, without accents, case or connecting words. */
function lawWords(phrase: string): string[] {
    return phrase
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word !== "" && !LAW_STOPWORDS.has(word));
}

/**
 * The normalized identity of a law named in a text, or null when it cannot be
 * established. Two spellings of one law (its name, its abbreviation, «la
 * Constitución») give the same identity; two different laws never do.
 */
export function normalizeLaw(name: string): string | null {
    const plain = lawWords(name).join(" ");
    if (!plain) return null;
    const alias = LAW_ALIASES[plain];
    const full = alias ? lawWords(alias).join(" ") : plain;
    // Not an alias: it must be written as a law («Ley …», «Código …»); a bare
    // head («la ley», «el código») or any other text names none.
    if (!alias && (!LAW_HEADS.has(full.split(" ")[0]) || !full.includes(" "))) return null;
    return full;
}

/** The law a document is, from its title («Ley Federal del Trabajo.pdf», «LFT.docx»), or null. */
export function lawOfTitle(title: string | null | undefined): string | null {
    if (!title) return null;
    const stem = title.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ");
    return normalizeLaw(stem);
}

const LAW_SEPARATOR = /^\s*(?:,\s*)?(?:de\s+la|de\s+las|de\s+los|del|de|en\s+la|en\s+el|segun\s+la)\s+/;
/** Every pattern read through `sticky`, by name (a test checks each one, and that no call site uses another). */
export const STICKY_PATTERNS: Readonly<Record<string, RegExp>> = {
    LIST_SEPARATOR, RANGE_SEPARATOR, ARTICLE_ITEM, FRACTION_AFTER_ARTICLE, FRACTION_OF_ARTICLE, ROMAN_ITEM,
    THESIS_ITEM, THESIS_SUBJECT, REGISTRY_ITEM, GAP, CONSTITUTIONAL_ADJECTIVE, DIRECT_LAW, LAW_SEPARATOR,
};
// Connecting words that may sit inside a law's written name («Ley del Impuesto sobre la Renta»).
const NAME_CONNECTORS = new Set([
    "de", "del", "la", "las", "los", "el", "lo", "y", "e", "o", "u", "a", "al", "en", "para", "por", "con", "sin",
    "sobre", "contra", "entre", "ante", "bajo", "hacia", "hasta", "desde", "mediante", "segun", "tras",
]);
const ALIAS_MAX_WORDS = Math.max(...Object.keys(LAW_ALIASES).map((alias) => alias.split(" ").length));

type Token = { bare: string; ends: boolean; opens: boolean };

const OPENING_PUNCTUATION = "([«\"'¿¡";
const CLOSING_PUNCTUATION = ".,;:)]»\"'?!";

/** `word` without the opening and closing punctuation around it (a linear scan, no regex backtracking). */
function trimPunctuation(word: string): string {
    let start = 0;
    while (start < word.length && OPENING_PUNCTUATION.includes(word[start])) start++;
    let end = word.length;
    while (end > start && CLOSING_PUNCTUATION.includes(word[end - 1])) end--;
    return word.slice(start, end);
}

/** The whitespace-separated words of `text`, each without the punctuation around it. */
function tokens(text: string): Token[] {
    return text
        .split(/\s+/)
        .filter((word) => word !== "")
        .map((word) => ({
            bare: trimPunctuation(word),
            ends: /[.,;:)\]»"'?!]$/.test(word),
            opens: /^[(\[«"'¿¡]/.test(word),
        }));
}

// What may follow a bare alias of the federal constitution («Constitución», «Carta
// Magna», «artículo 5 constitucional») and make it another constitution («local»,
// «de Tlaxcala», «Política del Estado de Jalisco»): then it is no longer the
// federal one and the law is unknown (fail closed). One rule for every alias.
const LOCAL_WORDS = new Set(["local", "locales", "estatal", "estatales"]);
const PLACE_WORDS = new Set([
    "estado", "ciudad",
    "aguascalientes", "baja", "campeche", "chiapas", "chihuahua", "coahuila", "colima", "durango", "guanajuato",
    "guerrero", "hidalgo", "jalisco", "mexico", "michoacan", "morelos", "nayarit", "nuevo", "oaxaca", "puebla",
    "queretaro", "quintana", "san", "sinaloa", "sonora", "tabasco", "tamaulipas", "tlaxcala", "veracruz", "yucatan",
    "zacatecas", "cdmx",
]);
const CONSTITUTION_QUALIFIERS = new Set([...LOCAL_WORDS, ...PLACE_WORDS, "particular", "general", "politica", "de", "del"]);
const FEDERAL_CONSTITUTION_TAIL = ["de los estados unidos mexicanos", "politica de los estados unidos mexicanos"];
// Closed list of connectors after «Constitución» that qualify nothing («de acuerdo con la
// Constitución», «de 1917»). «del país» and «de la República» are NOT here: an adjective,
// a nationality or a state after them («del país vecino») names another constitution.
const NEUTRAL_CONNECTORS = ["de acuerdo con", "de conformidad con", "de 1917"];
// After a neutral connector the federal constitution is kept only at the end of the text,
// at punctuation, or before one of these words, which clearly qualify nothing; any other
// word (an adjective, a nationality, «la de Tlaxcala», a state) leaves the law unknown.
const NON_QUALIFYING_AFTER_CONNECTOR = ["que", "se", "es", "establece", "dispone", "senala", "preve", "vigente", "la ley", "las leyes"];
// Aliases of the federal constitution that a qualifier turns into another law.
const QUALIFIABLE_ALIASES = new Set(["constitucion", "carta magna"]);

/** Whether what follows a neutral connector (from `index`) may name another constitution: anything but the end of the text or a word that clearly qualifies nothing. */
function qualifiesAfterConnector(lower: Token[], index: number): boolean {
    if (lower[index] === undefined) return false;
    const following = lower.slice(index, index + 2).map((token) => token.bare).join(" ");
    return !NON_QUALIFYING_AFTER_CONNECTOR.some((word) => following === word || following.startsWith(`${word} `));
}

/** Whether the token at `index` qualifies the bare alias before it into a law that is not the federal constitution. */
function qualifiesConstitution(lower: Token[], index: number): boolean {
    const next = lower[index];
    if (!next) return false;
    const rest = lower.slice(index, index + 6).map((token) => token.bare).join(" ");
    if (FEDERAL_CONSTITUTION_TAIL.some((tail) => rest.startsWith(tail))) return false;
    if (!CONSTITUTION_QUALIFIERS.has(next.bare)) return false;
    for (const connector of NEUTRAL_CONNECTORS) {
        const size = connector.split(" ").length;
        const written = lower.slice(index, index + size);
        if (written.map((token) => token.bare).join(" ") !== connector || written.slice(0, -1).some((token) => token.ends)) continue;
        // «Constitución de 1917 de Tlaxcala», «… de acuerdo con la de Tlaxcala»: fail closed.
        return !written[size - 1].ends && qualifiesAfterConnector(lower, index + size);
    }
    return true;
}

/** «constitucional» followed by «local», «estatal», «de/del <estado>» or «de la Constitución <estado>»: a state constitution, not the federal one. */
function qualifiesConstitutional(plain: string, at: number): boolean {
    const gap = sticky(GAP, plain, at);
    if (!gap) return false;
    const start = at + gap[0].length;
    const words = tokens(plain.slice(start, start + 200)).slice(0, 12);
    if (words.length === 0) return false;
    if (LOCAL_WORDS.has(words[0].bare)) return true;
    if (words[0].ends || (words[0].bare !== "de" && words[0].bare !== "del")) return false;
    const article = words[1] && (words[1].bare === "la" || words[1].bare === "el");
    const place = article ? words[2] : words[1];
    if (place !== undefined && PLACE_WORDS.has(place.bare)) return true;
    // «de la Constitución …», «de la Carta Magna …»: the same rule as for the alias written alone.
    if (!article || words[1].ends || place === undefined || place.ends) return false;
    if (place.bare === "constitucion") return qualifiesConstitution(words, 3);
    if (place.bare === "carta" && words[3]?.bare === "magna" && !words[3].ends) return qualifiesConstitution(words, 4);
    return false;
}

const isCapitalized = (word: string) => /^[A-ZÑ0-9]/.test(word);

/**
 * The law a name written in prose starts with (`plain` is the same text folded
 * to lower case, `cased` keeps its capitals); null when none can be delimited.
 *  - A known abbreviation or alias is matched first, longest first («LFT»,
 *    «Constitución Federal»), so what follows it («exige…») is never read.
 *  - A name that starts with «Ley», «Código», … takes words while they are
 *    capitalized or numbers, or connectors followed by one; it stops at the
 *    first other lower-case word or at punctuation.
 *  - A lower-case name that is not a known alias has no boundary: null (the
 *    law is unverified). A name cut by the word limit while it goes on is null too.
 */
function lawNamedAt(plain: string, cased: string): string | null {
    // A name takes at most LAW_PHRASE_MAX_WORDS words (plus a few of look-ahead), so only a window of
    // the text is tokenized, not its whole tail (that made a text with many articles quadratic). The
    // window ends in a sentinel token that flags being read: if the answer needed it, the window is
    // widened, so the result is the one the whole tail would give.
    for (let size = LAW_WINDOW_CHARS; size < plain.length; size *= 4) {
        let reached = false;
        const sentinel = (): Token => ({
            get bare() { reached = true; return "\u0000"; },
            get ends() { reached = true; return true; },
            get opens() { reached = true; return false; },
        });
        const lower = tokens(plain.slice(0, size)).slice(0, -1); // the last word may be cut by the window
        const upper = tokens(cased.slice(0, size)).slice(0, -1);
        if (lower.length === 0) continue;
        lower.push(sentinel());
        upper.push(sentinel());
        const law = lawNamedAtTokens(lower, upper);
        if (!reached) return law;
    }
    return lawNamedAtTokens(tokens(plain), tokens(cased));
}

function lawNamedAtTokens(lower: Token[], upper: Token[]): string | null {
    if (lower.length === 0 || lower.length !== upper.length) return null;
    const alias = (): string | null => {
        for (let count = Math.min(ALIAS_MAX_WORDS, lower.length); count >= 1; count--) {
            const span = lower.slice(0, count);
            // A phrase ends where punctuation does: «constitucion, federal» is not one name.
            if (span.slice(0, -1).some((token) => token.ends)) continue;
            const written = span.map((token) => token.bare).join(" ");
            if (LAW_ALIASES[written]) {
                if (QUALIFIABLE_ALIASES.has(written) && !span[count - 1].ends && qualifiesConstitution(lower, count)) return null;
                return normalizeLaw(written);
            }
        }
        return null;
    };
    if (!LAW_HEADS.has(lower[0].bare)) return alias();
    // Written in lower case («la constitución exige»), only a known alias has a boundary;
    // any other lower-case name: the name has no boundary, so none is invented.
    if (!isCapitalized(upper[0].bare)) return alias();
    const words: string[] = [];
    let index = 0;
    while (index < upper.length) {
        if (words.length >= LAW_PHRASE_MAX_WORDS) {
            // Cut short by the limit while the name goes on: its end is unknown.
            const previous = upper[index - 1];
            const next = upper[index];
            if (!previous.ends && !next.opens && (NAME_CONNECTORS.has(lower[index].bare) || isCapitalized(next.bare))) return null;
            break;
        }
        const token = upper[index];
        const connector = NAME_CONNECTORS.has(lower[index].bare);
        // A connector written with a capital («El») starts a sentence, not a name.
        // Except the letter «A» right after the head, which names («Ley A»).
        const letterName = index === 1 && token.bare === "A";
        if ((index > 0 && token.opens) || (connector && !letterName && token.bare !== lower[index].bare)) break;
        if (letterName) {
            words.push("a");
            index++;
            if (token.ends) break;
            continue;
        }
        if (!connector && isCapitalized(token.bare)) {
            words.push(lower[index].bare);
            index++;
            if (token.ends) break;
            continue;
        }
        if (!connector || token.ends) break;
        // A run of connectors belongs to the name only when a capitalized word follows it.
        let last = index;
        while (last < upper.length && NAME_CONNECTORS.has(lower[last].bare) && upper[last].bare === lower[last].bare && !upper[last].ends) last++;
        if (last >= upper.length || NAME_CONNECTORS.has(lower[last].bare) || !isCapitalized(upper[last].bare) || upper[last].opens) break;
        for (let take = index; take < last; take++) words.push(lower[take].bare);
        index = last;
    }
    // «Constitución local»: the bare head stopped at a qualifier is another constitution.
    if (words.length === 1 && words[0] === "constitucion" && !upper[index - 1]?.ends && qualifiesConstitution(lower, index)) return null;
    // «Constitución de 1917» written with capitals: the federal one, unless a qualifier follows.
    // `index` is past the last word taken, so punctuation on it ends the name: nothing follows.
    if (words.join(" ") === "constitucion de 1917" && (upper[index - 1].ends || !qualifiesAfterConnector(lower, index))) return normalizeLaw("constitucion");
    return normalizeLaw(words.join(" "));
}

/** The law named right after an article (or list of articles) ending at `at`; null when none is named. */
function readLaw(plain: string, at: number, cased: string = plain): { law: string | null; named: boolean } {
    const adjective = sticky(CONSTITUTIONAL_ADJECTIVE, plain, at);
    if (adjective) return { law: qualifiesConstitutional(plain, at + adjective[0].length) ? null : normalizeLaw("constitucion"), named: true };
    const separator = sticky(LAW_SEPARATOR, plain, at);
    const direct = separator ? null : sticky(DIRECT_LAW, plain, at);
    if (direct) {
        const law = LAW_ALIASES[direct[1]] ? normalizeLaw(direct[1]) : null;
        return { law, named: law !== null };
    }
    if (!separator) return { law: null, named: false };
    const from = at + separator[0].length;
    // A «de …» that names no law (a contract, «esta ley») is another source, not this one's.
    return { law: lawNamedAt(plain.slice(from), cased.slice(from)), named: true };
}

/**
 * The legal references a text names, each article with its law: «art:5@ley
 * federal del trabajo». The law is the one the text names right after the
 * article («artículo 5 de la Ley Federal del Trabajo», «art. 5 LFT», «artículo
 * 5 constitucional»), or, when the text names none, `sourceLaw` (the law the
 * document the text comes from is). With neither, the article ends in
 * «@?»: the law cannot be established and the reference never matches.
 * Theses and registry numbers are as in `legalReferences`.
 */
export function lawReferences(text: string, sourceLaw: string | null = null): Set<string> {
    const plain = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const found = new Set<string>();
    // The same text with its capitals: they bound a law's name in prose.
    const folded = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const cased = folded.toLowerCase() === plain ? folded : plain;
    const lawAfter = (end: number): string => {
        const read = readLaw(plain, end, cased);
        return read.law ?? (read.named ? UNKNOWN_LAW : (sourceLaw ?? UNKNOWN_LAW));
    };
    for (const head of plain.matchAll(ARTICLE_HEAD)) {
        const listed = readEnumeration(plain, head.index + head[0].length, readArticle);
        if (!listed) continue;
        const law = lawAfter(listed.end);
        for (const article of listed.items) {
            found.add(`art:${article.key}@${law}`);
            for (const fraction of article.fractions) found.add(`art:${article.key}:fr:${fraction}@${law}`);
        }
    }
    for (const head of plain.matchAll(FRACTION_HEAD)) {
        const fractions = readEnumeration(plain, head.index + head[0].length, readRoman);
        const link = fractions && sticky(FRACTION_OF_ARTICLE, plain, fractions.end);
        const article = fractions && link && readArticle(plain, fractions.end + link[0].length);
        if (article) {
            const law = lawAfter(article.end);
            for (const fraction of fractions.items) found.add(`art:${article.key}:fr:${fraction.key}@${law}`);
        }
    }
    for (const key of legalReferences(text)) if (!key.startsWith("art:")) found.add(key);
    return found;
}

/** Whether a strict key (see `lawReferences`) is an article whose law is established. */
export function hasKnownLaw(key: string): boolean {
    return !key.startsWith("art:") || !key.endsWith(`@${UNKNOWN_LAW}`);
}
