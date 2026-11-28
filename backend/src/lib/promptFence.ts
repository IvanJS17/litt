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

// 0 plain, 1 not plain, 255 not computed yet. Filled 256 units at a time, only
// for the blocks the texts actually use.
const KIND = new Uint8Array(0x10000).fill(255);

function kindOf(code: number): number {
    const known = KIND[code];
    if (known !== 255) return known;
    const base = code & ~0xff;
    for (let c = base; c < base + 0x100; c++) KIND[c] = isPlain(c) ? 0 : 1;
    return KIND[code];
}

const FOLD_CACHE = new Map<string, string>();

/**
 * What a reader would see of `text`: compatibility forms folded, lower case,
 * invisible characters dropped. `from[i]` and `to[i]` are the original range
 * the folded unit `i` comes from.
 */
function folded(text: string): { chars: string; from: Int32Array; to: Int32Array } {
    let cap = text.length + 64;
    let units = new Uint16Array(cap);
    let from = new Int32Array(cap);
    let to = new Int32Array(cap);
    let n = 0;
    let at = 0;
    while (at < text.length) {
        if (n + 64 > cap) {
            cap *= 2;
            const u = new Uint16Array(cap);
            const f = new Int32Array(cap);
            const t = new Int32Array(cap);
            u.set(units);
            f.set(from);
            t.set(to);
            units = u;
            from = f;
            to = t;
        }
        const code = text.charCodeAt(at);
        if (code < 0x80) {
            units[n] = code >= 65 && code <= 90 ? code + 32 : code;
            from[n] = at;
            to[n] = at + 1;
            n++;
            at++;
            continue;
        }
        const ch = String.fromCodePoint(text.codePointAt(at)!);
        const end = at + ch.length;
        if (!isInvisible(code)) {
            let out = FOLD_CACHE.get(ch);
            if (out === undefined) {
                out = ch.normalize("NFKC").toLowerCase();
                if (FOLD_CACHE.size >= 4096) FOLD_CACHE.clear();
                FOLD_CACHE.set(ch, out);
            }
            // A character folds to at most 18 units, so the 64 kept free above are enough.
            for (let k = 0; k < out.length && k < 32; k++) {
                units[n] = out.charCodeAt(k);
                from[n] = at;
                to[n] = end;
                n++;
            }
        }
        at = end;
    }
    const chars = new TextDecoder("utf-16le").decode(new Uint8Array(units.buffer, 0, n * 2));
    return { chars, from, to };
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
 * One pass over the original text, so nothing it writes can complete another
 * token, and the cost is linear in the length of the text.
 */
export function neutralizeFence(text: string, nonce: string, reservedTags: readonly string[]): string {
    const source = String(text);
    const key = folded(nonce).chars;
    const names = reservedTags.map((name) => folded(name).chars).filter(Boolean);
    if (provablyClean(source, key, names.length > 0)) return source;
    const { chars, from, to } = folded(source);
    const edits: Array<[number, number, string]> = [];
    if (key) {
        for (let at = chars.indexOf(key); at >= 0; at = chars.indexOf(key, at + key.length)) {
            edits.push([from[at], to[at + key.length - 1], "[redacted-nonce]"]);
        }
    }
    if (names.length) {
        for (let at = chars.indexOf("<"); at >= 0; at = chars.indexOf("<", at + 1)) {
            let pos = at + 1;
            while (pos < chars.length && isBlank(chars.charCodeAt(pos))) pos++;
            if (chars[pos] === "/") pos++;
            while (pos < chars.length && isBlank(chars.charCodeAt(pos))) pos++;
            for (const name of names) {
                if (chars.startsWith(name, pos)) {
                    edits.push([from[at], to[at], "&lt;"]);
                    break;
                }
            }
        }
    }
    if (!edits.length) return source;
    edits.sort((a, b) => a[0] - b[0]);
    let out = "";
    let done = 0;
    for (const [start, end, replacement] of edits) {
        if (start < done) continue; // inside an earlier replacement
        out += source.slice(done, start) + replacement;
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
