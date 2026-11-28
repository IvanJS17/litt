// Untrusted text handed to a model as data, never as instructions (LiTT
// training, docs/training.md). Each block is tagged with a per-call random
// nonce; the text cannot forge the closing tag because the nonce is redacted
// from it and every reserved tag it contains is escaped.

import { randomBytes } from "node:crypto";

/** A fresh nonce for one model call. */
export function promptNonce(): string {
    return randomBytes(8).toString("hex");
}

// Characters a reader does not see: zero-width, soft hyphen, word joiner,
// bidi controls and similar. They are skipped when looking for a token.
function isInvisible(code: number): boolean {
    return (
        code === 0xad || code === 0x34f || code === 0x61c || code === 0x180e ||
        (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2060 && code <= 0x2064) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
    );
}

// `\s`, written out (a character code test is cheaper than a regular expression per `<`).
export function isBlank(code: number): boolean {
    return (
        code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 ||
        (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
        code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
    );
}

// A unit is "plain" when folding it changes nothing but ASCII case: it is not
// invisible, not a surrogate, `normalize("NFKC")` leaves it as it is, its lower
// case is one unit, and it is not capital sigma (the one character whose lower
// case in a whole string depends on its neighbours: the final-sigma rule).
function isPlain(code: number): boolean {
    if (code >= 0xd800 && code <= 0xdfff) return false;
    if (code === 0x3a3 || isInvisible(code)) return false;
    const ch = String.fromCharCode(code);
    return ch.normalize("NFKC") === ch && ch.toLowerCase().length === 1;
}

// Tables over the code space, filled lazily 256 code points at a time, only for
// the blocks the texts actually use (about 0.1 ms per block; the whole code
// space would be about 0.45 s, once per process, so nothing is prefilled).
// KIND: 0 plain, 1 not plain, 255 not computed yet; LOWER: the single lower-case
// unit of a plain BMP unit (its whole fold).
const KIND = new Uint8Array(0x10000).fill(255);
const LOWER = new Uint16Array(0x10000);

function kindOf(code: number): number {
    const known = KIND[code];
    if (known !== 255) return known;
    const base = code & ~0xff;
    for (let c = base; c < base + 0x100; c++) {
        const plain = isPlain(c);
        KIND[c] = plain ? 0 : 1;
        if (plain) LOWER[c] = String.fromCharCode(c).toLowerCase().charCodeAt(0);
    }
    return KIND[code];
}

// Astral planes: 0 the fold of the code point is itself, 1 it is not, 255 not computed yet.
let astralKind: Uint8Array | undefined;

function foldsToItself(cp: number): boolean {
    astralKind ??= new Uint8Array(0x100000).fill(255);
    const known = astralKind[cp - 0x10000];
    if (known !== 255) return known === 0;
    const base = (cp - 0x10000) & ~0xff;
    for (let c = base; c < base + 0x100; c++) {
        const ch = String.fromCodePoint(c + 0x10000);
        astralKind[c] = ch.normalize("NFKC").toLowerCase() === ch ? 0 : 1;
    }
    return astralKind[cp - 0x10000] === 0;
}

// Only the code points that have a mapping (compatibility forms, upper case outside the
// plain rule, a few astral ones) and the lone surrogates reach these two maps: a few
// thousand in all (counted in the tests), so they need no size limit.
const FOLD_CACHE = new Map<number, string>();

/**
 * What a reader sees of one code point: the lower case of its compatibility
 * form (cut at 32 units), nothing for an invisible character.
 */
function foldOf(cp: number): string {
    if (cp < 0x80) return String.fromCharCode(cp >= 65 && cp <= 90 ? cp + 32 : cp);
    if (isInvisible(cp)) return "";
    let out = FOLD_CACHE.get(cp);
    if (out === undefined) {
        out = String.fromCodePoint(cp).normalize("NFKC").toLowerCase().slice(0, 32);
        FOLD_CACHE.set(cp, out);
    }
    return out;
}

const INERT_CACHE = new Map<number, boolean>();

/**
 * A code point is inert when its fold has several units, each of them either
 * not ASCII or an ASCII blank, and at least one of them is neither (U+FDFA
 * folds to words separated by spaces).
 */
function isInert(cp: number, fold: string): boolean {
    let inert = INERT_CACHE.get(cp);
    if (inert === undefined) {
        inert = fold.length > 1;
        let visible = false;
        for (let k = 0; inert && k < fold.length; k++) {
            const unit = fold.charCodeAt(k);
            if (unit >= 0x80 && !isBlank(unit)) visible = true;
            else if (unit < 0x80 && !isBlank(unit)) inert = false;
        }
        inert = inert && visible;
        INERT_CACHE.set(cp, inert);
    }
    return inert;
}

/** `foldOf` over a short string (the nonce, a tag name). */
function folded(small: string): string {
    let out = "";
    for (let at = 0; at < small.length; ) {
        const cp = small.codePointAt(at)!;
        out += foldOf(cp);
        at += cp > 0xffff ? 2 : 1;
    }
    return out;
}

const NOT_ASCII = /[^\x00-\x7f]/;

/** Whether the fold of a reserved name contains `<`; an ASCII-only name does exactly when its raw text does. */
function hasOpeningAngle(name: string): boolean {
    return name.includes("<") || (NOT_ASCII.test(name) && folded(name).includes("<"));
}

/**
 * True only when the text cannot contain the nonce or a reserved tag in any
 * written form, decided without folding it. Every unit is plain, so a token
 * can only be written in ASCII (a plain unit folds to its own lower case, and
 * no plain non-ASCII unit lower-cases to an ASCII letter): a tag needs an ASCII
 * `<`, and a nonce that is `key.length >= 16` hex characters needs that many
 * hex characters in a row. Any other nonce (a short one, one that is not hex)
 * is never rejected here: such text takes the folding path.
 */
function provablyClean(text: string, key: string, wantsTags: boolean): boolean {
    if (!key && !wantsTags) return true;
    const hexKey = /^[0-9a-f]{16,}$/.test(key);
    if (key && !hexKey) return false;
    const need = hexKey ? key.length : Infinity;
    let run = 0;
    for (let at = 0; at < text.length; at++) {
        const code = text.charCodeAt(at);
        if (code < 0x80) {
            if (code === 60 && wantsTags) return false; // <
            if ((code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)) {
                if (++run >= need) return false;
            } else run = 0;
        } else {
            run = 0;
            if (kindOf(code) !== 0) return false;
        }
    }
    return true;
}

/**
 * `text` made safe to sit inside a fence: the nonce is replaced by
 * `[redacted-nonce]` and the `<` of every reserved tag (`<name`, `</name`) is
 * written `&lt;`, however the token is written (letter case, invisible
 * characters inside it, Unicode compatibility forms, whitespace after `<` or
 * `</`). Only the matched token changes; all other text is returned as it is.
 *
 * One pass over the original text, nothing proportional to it is kept: each
 * folded unit feeds a nonce matcher (Knuth-Morris-Pratt, one state) and a tag
 * matcher (one candidate), and a match records an edit on the original
 * offsets. Edits are applied to the original text together, so nothing the
 * pass writes can complete another token.
 *
 * A reserved name cannot contain `<` (it throws), because a `<` in the text
 * always starts a new candidate tag.
 */
export function neutralizeFence(text: string, nonce: string, reservedTags: readonly string[]): string {
    const source = String(text);
    const key = folded(nonce);
    const names = reservedTags.map(folded).filter(Boolean);
    for (const reserved of reservedTags) if (hasOpeningAngle(reserved)) throw new Error("promptFence: a reserved tag name cannot contain '<'");
    if (provablyClean(source, key, names.length > 0)) return source;
    // When the nonce and every name are printable ASCII (no blank, no control character), an inert code point (see isInert) has the
    // same effect whatever the matchers hold: no unit of its fold is in the key (non-ASCII, or a blank
    // the key lacks), so the nonce matcher falls back to 0 and stays there; its first unit that is not
    // a blank is no `<`, `/`, blank or part of an ASCII name, so it drops any tag candidate, and no unit
    // is `<`, so none starts one; blanks around it change nothing. It is skipped in one step, not one per unit.
    const asciiTokens = [key, ...names].every((token) => /^[\x21-\x7f]*$/.test(token));
    // Nonce matcher. `ring` holds the original start of each of the last key.length folded units.
    // After a match the state restarts at 0: the next occurrence is searched after this one
    // (the leftmost non-overlapping occurrences, as indexOf(key, at + key.length) finds them).
    const size = key.length;
    const fail = new Int32Array(size);
    for (let i = 1, k = 0; i < size; i++) {
        while (k > 0 && key.charCodeAt(i) !== key.charCodeAt(k)) k = fail[k - 1];
        if (key.charCodeAt(i) === key.charCodeAt(k)) k++;
        fail[i] = k;
    }
    const ring = new Int32Array(size);
    let slot = 0;
    let matched = 0;
    // Tag matcher. state: 0 none, 1 after `<`, 2 after `<` and one `/`, 3 collecting a name.
    let state = 0;
    let tagStart = 0;
    let tagEnd = 0;
    let name = "";
    // Edits, flat: [start, end] pairs, nonce edits and tag edits apart (each already in order).
    const nonceEdits: number[] = [];
    const tagEdits: number[] = [];

    const feed = (unit: number, start: number, end: number) => {
        if (size) {
            ring[slot] = start;
            slot = slot + 1 === size ? 0 : slot + 1;
            while (matched > 0 && key.charCodeAt(matched) !== unit) matched = fail[matched - 1];
            if (key.charCodeAt(matched) === unit) matched++;
            if (matched === size) {
                nonceEdits.push(ring[slot], end);
                matched = 0;
            }
        }
        if (unit === 60) {
            state = 1;
            tagStart = start;
            tagEnd = end;
            name = "";
            return;
        }
        if (state === 0) return;
        if (state < 3) {
            if (isBlank(unit)) return;
            if (unit === 47 && state === 1) {
                state = 2;
                return;
            }
            state = 3;
        }
        name += String.fromCharCode(unit);
        if (names.includes(name)) {
            tagEdits.push(tagStart, tagEnd);
            state = 0;
        } else if (!names.some((reserved) => reserved.startsWith(name))) state = 0;
    };

    for (let at = 0; at < source.length; ) {
        const code = source.charCodeAt(at);
        if (code < 0x80) {
            feed(code >= 65 && code <= 90 ? code + 32 : code, at, at + 1);
            at++;
            continue;
        }
        const cp = source.codePointAt(at)!;
        if (cp < 0x10000) {
            if (kindOf(cp) === 0) {
                feed(LOWER[cp], at, at + 1);
                at++;
                continue;
            }
        } else if (foldsToItself(cp)) {
            feed(code, at, at + 2);
            feed(source.charCodeAt(at + 1), at, at + 2);
            at += 2;
            continue;
        }
        const end = at + (cp > 0xffff ? 2 : 1);
        const out = foldOf(cp);
        if (asciiTokens && out.length > 1 && isInert(cp, out)) {
            matched = 0;
            state = 0;
            at = end;
            continue;
        }
        for (let k = 0; k < out.length; k++) feed(out.charCodeAt(k), at, end);
        at = end;
    }
    if (!nonceEdits.length && !tagEdits.length) return source;

    // Apply in order of start (a nonce edit first on a tie); an edit that starts inside an earlier one is skipped.
    let out = "";
    let done = 0;
    let n = 0;
    let t = 0;
    while (n < nonceEdits.length || t < tagEdits.length) {
        const nonceNext = n < nonceEdits.length && (t >= tagEdits.length || nonceEdits[n] <= tagEdits[t]);
        const start = nonceNext ? nonceEdits[n] : tagEdits[t];
        const end = nonceNext ? nonceEdits[n + 1] : tagEdits[t + 1];
        if (nonceNext) n += 2;
        else t += 2;
        if (start < done) continue;
        out += source.slice(done, start) + (nonceNext ? "[redacted-nonce]" : "&lt;");
        done = end;
    }
    return out + source.slice(done);
}

/**
 * `text` inside `<tag nonce="…">…</tag nonce="…">`. `reservedTags` are the
 * tags of every block in the same prompt: none of them can be opened or
 * closed from inside the text.
 */
export function fenced(
    text: string,
    tag: string,
    nonce: string,
    reservedTags: readonly string[] = [tag],
): string {
    const names = [...new Set([tag, ...reservedTags])]
        .map((name) => name.replace(/[^a-z0-9-]/gi, ""))
        .filter(Boolean);
    const safe = neutralizeFence(text, nonce, names);
    return `<${tag} nonce="${nonce}">\n${safe}\n</${tag} nonce="${nonce}">`;
}
