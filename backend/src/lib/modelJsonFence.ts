/**
 * The one place where text that came from a model, or from a stored free-text
 * field, is scanned. That text is not under our control and is parsed on a
 * thread many requests share, so every scan here
 *
 *   1. refuses text over the limit its caller passes before it reads a single
 *      character (`BoundedTextError`: the caller turns it into the failure it
 *      already has for text it cannot read). Two primitives take text of any
 *      size on purpose: `splitFrontMatter` (it reads the lines of a bounded
 *      window) and `trimChars` when a caller passes `Infinity` for a short
 *      value of its own, such as a setting or a file name; and
 *   2. is plain scanning (`indexOf`, one pass, a lookup table), so its cost is
 *      proportional to the size of the text, never worse.
 *
 * Do not scan such text with a regular expression whose quantifiers nest or
 * overlap: add the primitive here instead. `__tests__/regexShapes.test.ts`
 * fails on those shapes in backend source.
 */

/**
 * How many characters a token of a model's answer is taken to hold, at most:
 * English and Spanish prose and JSON run at three to four, so five leaves
 * room. Sizes below are derived from token limits with it.
 */
export const MODEL_CHARS_PER_TOKEN = 5;

/** The most characters an answer of `tokens` tokens can hold. */
export const charsForTokens = (tokens: number): number => Math.ceil(tokens * MODEL_CHARS_PER_TOKEN);

/**
 * The most a model answer (or a model-written cell) may hold before it is
 * scanned: 1 MiB. The largest output ceiling of any model the product knows
 * is 128,000 tokens (`charsForTokens`: 640,000 characters); a router answers
 * at most 32,000 by default, a one-shot completion at most what its caller
 * asks for (24,096 tokens at the most). The scans here are linear, so the
 * bound is generous: it stops an answer that no model produces, not a long
 * one, and covers an operator's `LLM_MAX_OUTPUT_TOKENS` up to about 200,000.
 */
export const MODEL_TEXT_MAX_CHARS = 1024 * 1024;

/** How much of a long front matter header is read for its lines. */
export const FRONT_MATTER_MAX_CHARS = 16 * 1024;

/** Text was over the limit of the scan asked of it. */
export class BoundedTextError extends Error {
    readonly code = "text_too_long";
    constructor(
        readonly limit: number,
        readonly length: number,
    ) {
        super(`Text of ${length} characters is over the limit of ${limit}`);
        this.name = "BoundedTextError";
    }
}

/** The text itself when it is within `limit`; otherwise a `BoundedTextError`. */
export function assertBoundedText(text: string, limit: number = MODEL_TEXT_MAX_CHARS): string {
    if (text.length > limit) throw new BoundedTextError(limit, text.length);
    return text;
}

/** `\s` of a regular expression: the characters `String.prototype.trim` removes. */
function isSpace(code: number): boolean {
    return (
        (code >= 9 && code <= 13) ||
        code === 32 ||
        code === 0xa0 ||
        code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) ||
        code === 0x2028 ||
        code === 0x2029 ||
        code === 0x202f ||
        code === 0x205f ||
        code === 0x3000 ||
        code === 0xfeff
    );
}

const isAsciiLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isWordChar = (code: number) => isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 95;
const foldAscii = (code: number) => (code >= 65 && code <= 90 ? code + 32 : code);

/** Whether `text` holds the lowercase ASCII `word` at `at`, ignoring case. */
function hasWordAt(text: string, at: number, word: string): boolean {
    if (at + word.length > text.length) return false;
    for (let i = 0; i < word.length; i++) if (foldAscii(text.charCodeAt(at + i)) !== word.charCodeAt(i)) return false;
    return true;
}

function skipSpaces(text: string, from: number, to: number = text.length): number {
    let i = from;
    while (i < to && isSpace(text.charCodeAt(i))) i++;
    return i;
}

// ─── Code fences ────────────────────────────────────────────────────────────

/**
 * A model answer without the Markdown code fence it may be wrapped in: an
 * opening fence (with an optional `json` label) and a closing fence are each
 * removed when present. The result is trimmed.
 */
export function stripCodeFence(raw: string, limit: number = MODEL_TEXT_MAX_CHARS): string {
    const text = assertBoundedText(raw, limit).trim();
    let out = text;
    if (text.startsWith("```")) {
        let start = 3;
        if (hasWordAt(text, 3, "json")) start = 7;
        out = text.slice(skipSpaces(text, start));
    }
    if (out.endsWith("```")) {
        out = out.slice(0, -3).trimEnd();
    }
    return out;
}

/**
 * The inside of an answer that is wholly one fenced block (``` and an optional
 * label of letters, to a closing ```); any other answer, trimmed, as it is.
 */
export function unwrapFencedAnswer(raw: string, limit: number = MODEL_TEXT_MAX_CHARS): string {
    const text = assertBoundedText(raw, limit).trim();
    if (text.length < 6 || !text.startsWith("```") || !text.endsWith("```")) return text;
    let start = 3;
    while (start < text.length - 3 && isAsciiLetter(text.charCodeAt(start))) start++;
    return text.slice(start, text.length - 3).trim();
}

/**
 * The inside of an answer that is wholly one fenced ```json block, whose lines
 * begin on a line of their own (the opening fence ends in a line break and the
 * closing fence is on its own line); any other answer, trimmed, as it is.
 */
export function unwrapFencedJsonBlock(raw: string, limit: number = MODEL_TEXT_MAX_CHARS): string {
    const text = assertBoundedText(raw, limit).trim();
    if (!text.startsWith("```")) return text;
    const afterLabel = hasWordAt(text, 3, "json") ? 7 : 3;
    const bodyStart = skipSpaces(text, afterLabel);
    const firstBreak = text.indexOf("\n", afterLabel);
    const closeAt = text.length - 4;
    if (firstBreak < 0 || firstBreak >= bodyStart || !text.endsWith("\n```") || firstBreak + 1 > closeAt) return text;
    return text.slice(firstBreak + 1, closeAt).trim();
}

// ─── Inline citation markers ────────────────────────────────────────────────

export type InlineCitationMarker = {
    /** Where the marker `[[...]]` starts. */
    start: number;
    /** Just past its closing `]]`. */
    end: number;
    /** What is between the double brackets. */
    metadata: string;
};

/**
 * The `[[...]]` markers of a text, left to right. A marker's inside is a run
 * of characters that are not brackets, or of `[...]` groups (a group may hold
 * `[` and runs to the first `]`); it is never empty.
 */
export function findInlineCitations(raw: string, limit: number = MODEL_TEXT_MAX_CHARS): InlineCitationMarker[] {
    const text = assertBoundedText(raw, limit);
    const length = text.length;
    // endAt[i]: where a marker whose inside is read from i ends, or -1. The
    // reading is deterministic, so each position is decided once, from the right.
    const endAt = new Int32Array(length + 1).fill(-1);
    let nextClose = -1;
    // nextClose is the first `]` at or after i + 1 while i is visited.
    for (let i = length - 1; i >= 0; i--) {
        const code = text.charCodeAt(i);
        if (code === 93) {
            endAt[i] = i + 1 < length && text.charCodeAt(i + 1) === 93 ? i + 2 : -1;
            nextClose = i;
        } else if (code === 91) {
            endAt[i] = nextClose < 0 ? -1 : endAt[nextClose + 1];
        } else {
            endAt[i] = endAt[i + 1];
        }
    }
    const markers: InlineCitationMarker[] = [];
    let from = 0;
    for (;;) {
        const start = text.indexOf("[[", from);
        if (start < 0) break;
        const inside = start + 2;
        const end = inside < length && text.charCodeAt(inside) !== 93 ? endAt[inside] : -1;
        if (end < 0) {
            from = start + 1;
            continue;
        }
        markers.push({ start, end, metadata: text.slice(inside, end - 2) });
        from = end;
    }
    return markers;
}

/** The text with each `[[...]]` marker replaced by what `replace` makes of it. */
export function replaceInlineCitations(
    raw: string,
    replace: (marker: string, metadata: string) => string,
    limit: number = MODEL_TEXT_MAX_CHARS,
): string {
    const text = assertBoundedText(raw, limit);
    let out = "";
    let at = 0;
    for (const marker of findInlineCitations(text, limit)) {
        out += text.slice(at, marker.start) + replace(text.slice(marker.start, marker.end), marker.metadata);
        at = marker.end;
    }
    return out + text.slice(at);
}

// ─── Tags, attributes and links ─────────────────────────────────────────────

export type LinkTarget = {
    /** The lowercase letters before the first `:` of the value, or "" when it has none. */
    scheme: string;
    /** The (up to nine) lowercase characters after that `:`, past any blanks. */
    detail: string;
};

export type HtmlScan = {
    /** The distinct lowercase names of the tags, `<name` or `</name`. */
    tagNames: Set<string>;
    /** Whether a tag holds an `on…=` attribute. */
    hasEventHandler: boolean;
    /** The value of each `href=`, `src=` or `xlink:href=` attribute inside a tag. */
    links: LinkTarget[];
};

const LINK_ATTRIBUTE = /(?<=\W)(?:href|src)\s*=/gi;
const EVENT_ATTRIBUTE = /(?<=\W)on[a-z]+\s*=/i;
const SCHEME_MAX = 16;
const DETAIL_CHARS = 9;

function readLinkTarget(text: string, from: number, to: number): LinkTarget {
    let i = skipSpaces(text, from, to);
    const quote = text.charCodeAt(i);
    if (i < to && (quote === 34 || quote === 39)) i++;
    i = skipSpaces(text, i, to);
    const letters = i;
    while (i < to && i - letters <= SCHEME_MAX && isAsciiLetter(text.charCodeAt(i))) i++;
    const scheme = text.slice(letters, i).toLowerCase();
    const colon = skipSpaces(text, i, to);
    if (colon >= to || text.charCodeAt(colon) !== 58 || scheme.length > SCHEME_MAX) return { scheme: "", detail: "" };
    const detail = skipSpaces(text, colon + 1, to);
    return { scheme, detail: text.slice(detail, Math.min(detail + DETAIL_CHARS, to)).toLowerCase() };
}

/**
 * The tags of a text and what is in them that can run or open something:
 * their names, whether one has an event-handler attribute, and the target of
 * each link attribute. A tag is what is between a `<` and the next `>` (or
 * the end of the text).
 */
export function scanHtml(raw: string, limit: number): HtmlScan {
    const text = assertBoundedText(raw, limit);
    const scan: HtmlScan = { tagNames: new Set(), hasEventHandler: false, links: [] };
    // Every `<`: blanks, an optional `/`, blanks, then the tag's name.
    for (let open = text.indexOf("<"); open >= 0; open = text.indexOf("<", open + 1)) {
        let i = skipSpaces(text, open + 1);
        if (text.charCodeAt(i) === 47) i = skipSpaces(text, i + 1);
        const nameAt = i;
        while (i < text.length && isWordChar(text.charCodeAt(i))) i++;
        if (i > nameAt) scan.tagNames.add(text.slice(nameAt, i).toLowerCase());
    }
    // Each stretch from a `<` to the next `>` is one tag; an attribute needs
    // at least one character of the tag before it.
    let pos = 0;
    for (;;) {
        const open = text.indexOf("<", pos);
        if (open < 0) break;
        const gt = text.indexOf(">", open + 1);
        const end = gt < 0 ? text.length : gt;
        const body = text.slice(open + 1, end);
        if (!scan.hasEventHandler && EVENT_ATTRIBUTE.test(body)) scan.hasEventHandler = true;
        LINK_ATTRIBUTE.lastIndex = 0;
        for (let match = LINK_ATTRIBUTE.exec(body); match; match = LINK_ATTRIBUTE.exec(body)) {
            scan.links.push(readLinkTarget(body, match.index + match[0].length, body.length));
        }
        pos = end + 1;
    }
    return scan;
}

/** The text with each `<...>` tag (`<` to the next `>`) replaced by `replacement`. */
export function replaceTags(raw: string, replacement: string, limit: number = MODEL_TEXT_MAX_CHARS): string {
    const text = assertBoundedText(raw, limit);
    let out = "";
    let at = 0;
    for (;;) {
        const open = text.indexOf("<", at);
        const close = open < 0 ? -1 : text.indexOf(">", open + 1);
        if (close < 0) break;
        out += text.slice(at, open) + replacement;
        at = close + 1;
    }
    return out + text.slice(at);
}

// ─── Tagged blocks ──────────────────────────────────────────────────────────

export type TaggedBlock = {
    /** Where `<tag>` starts. */
    start: number;
    /** Just past `</tag>`. */
    end: number;
    /** What is between them, trimmed. */
    inner: string;
};

function indexOfIgnoreCase(text: string, lowerNeedle: string, from: number): number {
    for (let at = text.indexOf("<", from); at >= 0; at = text.indexOf("<", at + 1)) {
        if (hasWordAt(text, at, lowerNeedle)) return at;
    }
    return -1;
}

/**
 * The `<tag>...</tag>` blocks of a text, left to right and not overlapping,
 * the tag name read without regard to case. An opening tag with no closing
 * tag after it ends the search: nothing after it can close either.
 */
export function findTaggedBlocks(raw: string, tag: string, limit: number = MODEL_TEXT_MAX_CHARS): TaggedBlock[] {
    const text = assertBoundedText(raw, limit);
    const open = `<${tag.toLowerCase()}>`;
    const close = `</${tag.toLowerCase()}>`;
    const blocks: TaggedBlock[] = [];
    let from = 0;
    for (;;) {
        const start = indexOfIgnoreCase(text, open, from);
        if (start < 0) break;
        const innerStart = start + open.length;
        const closeAt = indexOfIgnoreCase(text, close, innerStart);
        if (closeAt < 0) break;
        blocks.push({ start, end: closeAt + close.length, inner: text.slice(innerStart, closeAt).trim() });
        from = closeAt + close.length;
    }
    return blocks;
}

// ─── Front matter ───────────────────────────────────────────────────────────

/**
 * The lines of the front matter of a stored document: what is between a
 * first line `---` and the next line `---`; null for a text with none (or a
 * header that never closes). The text may be of any size: its end is found
 * by searching, which is linear. Of a header longer than `maxChars` only the
 * lines that end inside its first `maxChars` characters are given.
 */
export function splitFrontMatter(raw: string, maxChars: number = FRONT_MATTER_MAX_CHARS): string[] | null {
    let bodyStart: number;
    if (raw.startsWith("---\n")) bodyStart = 4;
    else if (raw.startsWith("---\r\n")) bodyStart = 5;
    else return null;
    for (let at = raw.indexOf("\n---", bodyStart); at >= 0; at = raw.indexOf("\n---", at + 1)) {
        const after = at + 4;
        const closes = raw.startsWith("\n", after) || raw.startsWith("\r\n", after) || after === raw.length;
        if (!closes) continue;
        const body = raw.slice(bodyStart, at > bodyStart && raw.charCodeAt(at - 1) === 13 ? at - 1 : at);
        if (body.length <= maxChars) return body.split(/\r?\n/);
        const lastWhole = body.lastIndexOf("\n", maxChars);
        return lastWhole < 0 ? [] : body.slice(0, lastWhole).split(/\r?\n/);
    }
    return null;
}

// ─── Labelled lines ─────────────────────────────────────────────────────────

const isMark = (code: number) => code === 42 || code === 95 || code === 96;

/** `ws* marks* ws*` from `from`: the index after it. */
function skipMarked(text: string, from: number, to: number): number {
    let i = skipSpaces(text, from, to);
    while (i < to && isMark(text.charCodeAt(i))) i++;
    return skipSpaces(text, i, to);
}

/** The same, read backwards from `to`: the index where it starts. */
function skipMarkedBackwards(text: string, from: number, to: number): number {
    let i = to;
    while (i > from && isSpace(text.charCodeAt(i - 1))) i--;
    while (i > from && isMark(text.charCodeAt(i - 1))) i--;
    while (i > from && isSpace(text.charCodeAt(i - 1))) i--;
    return i;
}

/**
 * `Label: value` as a model writes it, with Markdown marks (`*`, `_`, a
 * backtick) and blanks around the label and the value. The label is one of
 * `labels` (lowercase, single-spaced) read without regard to case; the value
 * is a single line. Null when the line is not of that form.
 */
export function readLabelledLine(
    raw: string,
    labels: readonly string[],
    limit: number = MODEL_TEXT_MAX_CHARS,
): { label: string; value: string } | null {
    const line = assertBoundedText(raw, limit);
    const labelStart = skipMarked(line, 0, line.length);
    const colon = line.indexOf(":", labelStart);
    if (colon < 0) return null;
    const labelEnd = skipMarkedBackwards(line, labelStart, colon);
    const label = line
        .slice(labelStart, labelEnd)
        .toLowerCase()
        .split(/\s+/)
        .join(" ");
    if (!labels.includes(label)) return null;
    const valueStart = skipMarked(line, colon + 1, line.length);
    const valueEnd = skipMarkedBackwards(line, valueStart, line.length);
    const value = line.slice(valueStart, valueEnd);
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) return null;
    }
    return { label, value };
}

// ─── Trimming ───────────────────────────────────────────────────────────────

/** The text without the `leading` characters at its start and the `trailing` ones at its end. */
export function trimChars(raw: string, leading: string, trailing: string, limit: number = MODEL_TEXT_MAX_CHARS): string {
    const text = assertBoundedText(raw, limit);
    let start = 0;
    while (start < text.length && leading.includes(text[start])) start++;
    let end = text.length;
    while (end > start && trailing.includes(text[end - 1])) end--;
    return text.slice(start, end);
}

// ─── List markers ───────────────────────────────────────────────────────────

const isLineTerminator = (code: number) => code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
const isDigit = (code: number) => code >= 48 && code <= 57;

/**
 * What follows a marker at `from`: blanks, then the text of the line. The text
 * is the rest of the line up to its first line terminator, and with `toEnd`
 * it must reach the end of the string. `null` when no blank follows the
 * marker or no text does.
 */
function textAfterBlanks(line: string, from: number, toEnd: boolean): string | null {
    const blanksEnd = skipSpaces(line, from);
    if (blanksEnd === from) return null;
    if (blanksEnd === line.length) {
        // Only blanks follow: the last of them that is not a line terminator is the text,
        // and at least one blank stays before it.
        let at = blanksEnd - 1;
        if (toEnd) return at > from && !isLineTerminator(line.charCodeAt(at)) ? line.slice(at) : null;
        while (at > from && isLineTerminator(line.charCodeAt(at))) at--;
        return at > from ? line.slice(at, at + 1) : null;
    }
    let end = blanksEnd;
    while (end < line.length && !isLineTerminator(line.charCodeAt(end))) end++;
    return toEnd && end < line.length ? null : line.slice(blanksEnd, end);
}

/** A typed number (`1.`, `2.3.1)`, `12`) and the text after it, for a trimmed line; null when it has none. */
export function numberedListMarker(line: string): { marker: string; text: string } | null {
    let at = 0;
    while (at < line.length && isDigit(line.charCodeAt(at))) at++;
    if (at === 0) return null;
    for (;;) {
        let next = at + 1;
        if (line.charCodeAt(at) !== 46 || !isDigit(line.charCodeAt(next))) break;
        while (next < line.length && isDigit(line.charCodeAt(next))) next++;
        at = next;
    }
    const marker = line.slice(0, at);
    const stop = line.charCodeAt(at);
    const text = textAfterBlanks(line, stop === 46 || stop === 41 ? at + 1 : at, true);
    return text === null ? null : { marker, text };
}

/** A typed letter marker (`(a)`, `b.`, `iv)`) and the text after it, for a trimmed line; null when it has none. */
export function letteredListMarker(line: string): { marker: string; text: string } | null {
    const open = line.charCodeAt(0) === 40;
    let at = open ? 1 : 0;
    while (at < line.length && isAsciiLetter(line.charCodeAt(at))) at++;
    if (at === (open ? 1 : 0)) return null;
    const close = line.charCodeAt(at);
    if (open ? close !== 41 : close !== 46 && close !== 41) return null;
    const text = textAfterBlanks(line, at + 1, true);
    return text === null ? null : { marker: line.slice(open ? 1 : 0, at), text };
}

/** The text after a typed bullet (`-`, `•`, `*`) at the start of a trimmed line; null when it has none. */
export function bulletListMarker(line: string): string | null {
    const mark = line.charCodeAt(0);
    if (mark !== 45 && mark !== 0x2022 && mark !== 42) return null;
    return textAfterBlanks(line, 1, false);
}
