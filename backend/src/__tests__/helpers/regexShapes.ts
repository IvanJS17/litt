// A small static reader of regular-expression source, for the test that keeps
// super-linear shapes out of backend code (`regexShapes.test.ts`). It parses
// the pattern itself (no dependency) and reports five shapes:
//
//   - "nested-quantifier": a group repeated without bound whose body repeats
//     something itself, such as `(a+)+` or `(?:x|\[[^\]]*\])+`;
//   - "overlapping-alternation": a group repeated without bound whose
//     alternatives can start with the same character (or one is empty), such
//     as `(a|a)*` or `(\w|\d)+`;
//   - "end-anchored-run": an unbounded run of single characters that is
//     anchored only at the end of the text (`\s+$`, `^x+|[.\s]+$`): the
//     engine tries it from every position, and each try reads to the end of
//     the run;
//   - "adjacent-quantifiers": two unbounded runs side by side, or with only
//     optional parts between them, that can match the same characters
//     (`\s*\s*`, `.*.*`, `\s*(.*?)\s*$`, `[^>]*>?[^>]*`): the characters can
//     be shared out between them in many ways;
//   - "unclosed-scan": a pattern that starts with a character, reads an
//     unbounded run that can contain that same character, and then needs
//     something to close it (`<[^>]+>`): without the close, each of those
//     characters starts a read to the end.
//
// The characters a single-character part can match are found by asking the
// engine itself about every UTF-16 unit (every code point under the `u` and
// `v` flags), so case folding, `\S`, `\p{..}` and non-ASCII characters are
// decided exactly, never by a sample.
//
// What it cannot see is listed in the test file.

type Atom = { start: number; end: number; node: Node };
type Node =
    | { t: "char"; value: string }
    | { t: "class" }
    | { t: "escape" }
    | { t: "backref" }
    | { t: "any" }
    | { t: "assert"; value: string }
    | { t: "group"; lookaround: boolean; look: string; branches: Seq[] }
    | { t: "quant"; atom: Atom; min: number; max: number };
type Seq = Atom[];

export type Shape = {
    kind: "nested-quantifier" | "overlapping-alternation" | "end-anchored-run" | "adjacent-quantifiers" | "unclosed-scan";
    detail: string;
};

class Reader {
    private i = 0;
    constructor(private readonly src: string) {}

    parse(): Seq[] {
        return this.alternation();
    }

    private alternation(): Seq[] {
        const branches: Seq[] = [[]];
        while (this.i < this.src.length) {
            const c = this.src[this.i];
            if (c === ")") break;
            if (c === "|") {
                this.i++;
                branches.push([]);
                continue;
            }
            const atom = this.atom();
            branches[branches.length - 1].push(this.quantified(atom));
        }
        return branches;
    }

    private atom(): Atom {
        const start = this.i;
        const c = this.src[this.i++];
        let node: Node;
        if (c === "(") {
            let lookaround = false;
            let look = "";
            if (this.src.startsWith("?<=", this.i) || this.src.startsWith("?<!", this.i)) {
                lookaround = true;
                look = this.src.slice(this.i + 1, this.i + 3);
                this.i += 3;
            } else if (this.src.startsWith("?=", this.i) || this.src.startsWith("?!", this.i)) {
                lookaround = true;
                look = this.src[this.i + 1];
                this.i += 2;
            } else if (this.src.startsWith("?:", this.i)) {
                this.i += 2;
            } else if (this.src.startsWith("?<", this.i)) {
                const close = this.src.indexOf(">", this.i);
                this.i = close < 0 ? this.src.length : close + 1;
            }
            const branches = this.alternation();
            if (this.src[this.i] === ")") this.i++;
            node = { t: "group", lookaround, look, branches };
        } else if (c === "[") {
            if (this.src[this.i] === "^") this.i++;
            while (this.i < this.src.length && this.src[this.i] !== "]") this.i += this.src[this.i] === "\\" ? 2 : 1;
            this.i++;
            node = { t: "class" };
        } else if (c === "\\") {
            const e = this.src[this.i++];
            let backref = false;
            if (e === "u" && this.src[this.i] === "{") {
                const close = this.src.indexOf("}", this.i);
                this.i = close < 0 ? this.src.length : close + 1;
            } else if (e === "u") this.i += 4;
            else if (e === "x") this.i += 2;
            else if ((e === "p" || e === "P") && this.src[this.i] === "{") {
                const close = this.src.indexOf("}", this.i);
                this.i = close < 0 ? this.src.length : close + 1;
            } else if (e === "k" && this.src[this.i] === "<") {
                const close = this.src.indexOf(">", this.i);
                this.i = close < 0 ? this.src.length : close + 1;
                backref = true;
            } else if (e === "c") this.i += 1;
            else if (e >= "1" && e <= "9") {
                while (this.src[this.i] >= "0" && this.src[this.i] <= "9") this.i++;
                backref = true;
            }
            node = backref ? { t: "backref" } : e === "b" || e === "B" ? { t: "assert", value: e } : { t: "escape" };
        } else if (c === ".") node = { t: "any" };
        else if (c === "^" || c === "$") node = { t: "assert", value: c };
        else node = { t: "char", value: c };
        return { start, end: this.i, node };
    }

    private quantified(atom: Atom): Atom {
        const c = this.src[this.i];
        let min = -1;
        let max = -1;
        if (c === "*") [min, max] = [0, Infinity];
        else if (c === "+") [min, max] = [1, Infinity];
        else if (c === "?") [min, max] = [0, 1];
        else if (c === "{") {
            const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(this.src.slice(this.i));
            if (m) {
                min = Number(m[1]);
                max = m[2] ? (m[3] === "" ? Infinity : Number(m[3])) : min;
                this.i += m[0].length - 1;
            }
        }
        if (min < 0) return atom;
        this.i++;
        if (this.src[this.i] === "?") this.i++;
        return { start: atom.start, end: this.i, node: { t: "quant", atom, min, max } };
    }
}

/** The characters a part can match, as a table of one byte per code (unit); null when it cannot be told. */
type Chars = Uint8Array;

const tables = new Map<string, Chars | null>();

function charsOf(source: string, flags: string): Chars | null {
    const key = `${flags}/${source}`;
    const known = tables.get(key);
    if (known !== undefined) return known;
    const wide = flags.includes("u") || flags.includes("v");
    let table: Chars | null = new Uint8Array(wide ? 0x110000 : 0x10000);
    try {
        const exact = new RegExp(`^(?:${source})$`, flags.replace(/[gyd]/g, ""));
        for (let code = 0; code < table.length; code++) {
            if (exact.test(wide ? String.fromCodePoint(code) : String.fromCharCode(code))) table[code] = 1;
        }
    } catch {
        table = null;
    }
    tables.set(key, table);
    return table;
}

const intersects = (a: Chars, b: Chars) => {
    for (let i = 0; i < a.length; i++) if (a[i] && b[i]) return true;
    return false;
};
const addTo = (into: Chars, from: Chars) => {
    for (let i = 0; i < from.length; i++) if (from[i]) into[i] = 1;
};

/** One item of a sequence, for the rules about runs. */
type Item =
    | { k: "run"; atom: Atom; min: number; chars: Chars | null; group?: boolean }
    | { k: "optional"; atom: Atom }
    | { k: "mandatory"; atom: Atom }
    | { k: "assert"; value: string };

class Analyzer {
    shapes: Shape[] = [];
    private readonly size: number;

    constructor(
        private readonly src: string,
        private readonly flags: string,
    ) {
        this.size = flags.includes("u") || flags.includes("v") ? 0x110000 : 0x10000;
    }

    private text(atom: Atom): string {
        return this.src.slice(atom.start, atom.end);
    }

    private report(kind: Shape["kind"], detail: string): void {
        if (!this.shapes.some((shape) => shape.kind === kind && shape.detail === detail)) this.shapes.push({ kind, detail });
    }

    private isSingle(atom: Atom): boolean {
        return ["char", "class", "escape", "any"].includes(atom.node.t);
    }

    /** The characters of one single-character part; null when unknown (a backreference, a pattern the engine refuses). */
    private chars(atom: Atom): Chars | null {
        const node = atom.node;
        if (node.t === "any") return charsOf(".", this.flags);
        if (node.t === "char" || node.t === "class" || node.t === "escape") return charsOf(this.text(atom), this.flags);
        return null;
    }

    /** The characters a match of `seq` can start with, and whether it can match nothing. */
    private first(seq: Seq): { chars: Chars; nullable: boolean } {
        const chars = new Uint8Array(this.size);
        for (const atom of seq) {
            const part = this.firstOf(atom);
            addTo(chars, part.chars);
            if (!part.nullable) return { chars, nullable: false };
        }
        return { chars, nullable: true };
    }

    private firstOf(atom: Atom): { chars: Chars; nullable: boolean } {
        const node = atom.node;
        const none = () => new Uint8Array(this.size);
        if (node.t === "assert" || node.t === "backref") return { chars: none(), nullable: true };
        if (node.t === "quant") {
            const inner = this.firstOf(node.atom);
            return { chars: inner.chars, nullable: inner.nullable || node.min === 0 };
        }
        if (node.t === "group") {
            if (node.lookaround) return { chars: none(), nullable: true };
            const chars = none();
            let nullable = false;
            for (const branch of node.branches) {
                const part = this.first(branch);
                addTo(chars, part.chars);
                nullable ||= part.nullable;
            }
            return { chars, nullable };
        }
        return { chars: this.chars(atom) ?? none(), nullable: false };
    }

    /** The characters a match of a mandatory part can end with; null when that cannot be told. */
    private lastOf(atom: Atom): Chars | null {
        const node = atom.node;
        if (this.isSingle(atom)) return this.chars(atom);
        if (node.t === "quant") return node.min >= 1 ? this.lastOf(node.atom) : null;
        if (node.t !== "group" || node.lookaround) return null;
        const out = new Uint8Array(this.size);
        for (const branch of node.branches) {
            const last = branch[branch.length - 1];
            const chars = last ? this.lastOf(last) : null;
            if (!chars) return null;
            addTo(out, chars);
        }
        return out;
    }

    /** Whether `atom` always matches exactly one character: a character, a class, or a group whose alternatives all do. */
    private oneChar(atom: Atom): boolean {
        if (this.isSingle(atom)) return true;
        const node = atom.node;
        return node.t === "group" && !node.lookaround && node.branches.every((branch) => branch.length === 1 && this.oneChar(branch[0]));
    }

    /** The characters a part that `oneChar` accepts can match; null when that cannot be told. */
    private charsOfOne(atom: Atom): Chars | null {
        const node = atom.node;
        if (node.t !== "group") return this.chars(atom);
        const out = new Uint8Array(this.size);
        for (const branch of node.branches) {
            const chars = this.charsOfOne(branch[0]);
            if (!chars) return null;
            addTo(out, chars);
        }
        return out;
    }

    private repeats(atom: Atom): boolean {
        const node = atom.node;
        if (node.t === "quant") return node.max > 1 || this.repeats(node.atom);
        if (node.t === "group") return node.branches.some((branch) => branch.some((a) => this.repeats(a)));
        return false;
    }

    /** The characters of every part repeated more than once inside `atom`; null when one of them cannot be told. */
    private repeatedChars(atom: Atom, inRepeat = false, into: Chars | null = new Uint8Array(this.size)): Chars | null {
        const node = atom.node;
        if (into === null) return null;
        if (node.t === "quant") return this.repeatedChars(node.atom, inRepeat || node.max > 1, into);
        if (node.t === "group") {
            for (const branch of node.branches) for (const a of branch) into = this.repeatedChars(a, inRepeat, into);
            return into;
        }
        if (!inRepeat) return into;
        if (node.t === "backref") return null;
        const chars = this.chars(atom);
        if (!chars) return null;
        addTo(into, chars);
        return into;
    }

    /**
     * A group of one sequence whose every repetition starts, or ends, with a
     * mandatory single character that nothing repeated inside it can match:
     * `(?:-[a-z]+)+`, `(?:[a-z]+\.)+`. The text then splits into repetitions
     * in only one way, so the repeat is not ambiguous. Disjointness has to be
     * proved: a part that cannot be read (a backreference) never is.
     */
    private delimited(group: Atom): boolean {
        const node = group.node;
        if (node.t !== "group" || node.branches.length !== 1) return false;
        const seq = node.branches[0];
        const repeated = this.repeatedChars(group);
        if (!repeated) return false;
        return [seq[0], seq[seq.length - 1]].some((end) => {
            if (end === undefined || !this.isSingle(end)) return false;
            const chars = this.chars(end);
            return chars !== null && !intersects(chars, repeated);
        });
    }

    // ─── Rules about runs ───────────────────────────────────────────────────

    /** The parts of a sequence in order; a group of one alternative and no quantifier is read in place. */
    private items(seq: Seq): Item[] {
        const out: Item[] = [];
        for (const atom of seq) {
            const node = atom.node;
            if (node.t === "assert") out.push({ k: "assert", value: node.value });
            else if (node.t === "group" && node.lookaround) {
                // A lookahead for the end of the text is the end anchor itself.
                const only = node.branches.length === 1 && node.branches[0].length === 1 ? node.branches[0][0].node : null;
                const atEnd = node.look === "=" && only?.t === "assert" && only.value === "$";
                out.push({ k: "assert", value: atEnd ? "$" : "look" });
            }
            else if (node.t === "group") {
                if (node.branches.length === 1) out.push(...this.items(node.branches[0]));
                else {
                    const nullable = node.branches.some((branch) => this.first(branch).nullable);
                    out.push({ k: nullable ? "optional" : "mandatory", atom });
                }
            } else if (node.t === "quant") {
                if (node.max === Infinity && this.oneChar(node.atom)) {
                    out.push({ k: "run", atom, min: node.min, chars: this.charsOfOne(node.atom) });
                } else if (node.max === Infinity && node.atom.node.t === "group" && !node.atom.node.lookaround) {
                    // Several characters repeated: it only takes part in the rule about the end of the text.
                    out.push({ k: "run", atom, min: node.min, chars: null, group: true });
                } else out.push({ k: node.min === 0 ? "optional" : "mandatory", atom });
            } else out.push({ k: "mandatory", atom });
        }
        return out;
    }

    private runShapes(seq: Seq, anchoredBefore: boolean, top: boolean): void {
        const items = this.items(seq);
        if (top && !anchoredBefore) this.unclosedScan(items);
        const multiline = this.flags.includes("m");
        let anchored = anchoredBefore;
        items.forEach((item, i) => {
            if (item.k === "assert" && item.value === "^" && !multiline) anchored = true;
            if (item.k !== "run") return;
            const name = this.text(item.atom);
            const loopBody = item.group === true;
            // Adjacent runs: nothing mandatory between them (or only a character both can match),
            // so the text can be shared out between them in many ways.
            const bridges: (Chars | null)[] = [];
            for (let j = i + 1; j < items.length && !loopBody; j++) {
                const next = items[j];
                if (next.k === "run" && next.group) {
                    if (next.min > 0) break;
                } else if (next.k === "run") {
                    const alike = !item.chars || !next.chars || intersects(item.chars, next.chars);
                    const bridged = next.chars === null || bridges.every((chars) => chars === null || intersects(chars, next.chars as Chars));
                    if (alike && bridged) {
                        this.report("adjacent-quantifiers", `${name} then ${this.text(next.atom)} can match the same characters`);
                    }
                    if (next.min > 0 || bridges.length > 0) break;
                } else if (next.k === "optional") {
                    continue;
                } else if (next.k === "mandatory" && this.oneChar(next.atom)) {
                    const chars = this.charsOfOne(next.atom);
                    if (chars !== null && (item.chars === null || !intersects(chars, item.chars))) break;
                    bridges.push(chars);
                } else break;
            }
            // A run read to the end of the text, from every position the text offers: only
            // fixed parts follow it up to the end of the text.
            let tailEnds = false;
            for (let k = i + 1; k < items.length; k++) {
                const tail = items[k];
                // Parts that match no character (a word boundary, a lookbehind) do not stop the run reading to the end.
                if (tail.k === "assert" && tail.value !== "$" && tail.value !== "^") continue;
                if (tail.k === "assert") {
                    tailEnds = true;
                    break;
                }
                if (tail.k === "run") break;
            }
            if (tailEnds && !anchored) {
                const before = items[i - 1];
                const stops =
                    before?.k === "mandatory" &&
                    item.chars !== null &&
                    (() => {
                        const last = this.lastOf(before.atom);
                        return last !== null && !intersects(last, item.chars);
                    })();
                if (!stops) this.report("end-anchored-run", `${name} is tried from every position and read to the end`);
            }
        });
    }

    /**
     * A pattern that starts with a mandatory character, then has an unbounded
     * run that can match that same character, and after it something mandatory
     * (`<w:t[^>]*>`, `<a>[\\s\\S]*?<\\/a>`, `\\[[^\\]]*\\]`): where the closing part is
     * missing, every occurrence of the opening character starts a run that
     * reads to the end.
     */
    private unclosedScan(items: Item[]): void {
        if (this.flags.includes("y")) return;
        const first = items[0];
        if (first?.k !== "mandatory" || !this.isSingle(first.atom)) return;
        const opener = this.chars(first.atom);
        if (!opener) return;
        items.forEach((item, i) => {
            if (item.k !== "run" || i === 0 || !item.chars || !intersects(opener, item.chars)) return;
            if (!items.slice(i + 1).some((later) => later.k === "mandatory")) return;
            this.report("unclosed-scan", `${this.text(item.atom)} can contain ${this.text(first.atom)}, so each ${this.text(first.atom)} starts a read to the end when the closing part is missing`);
        });
    }

    // ─── Walk ───────────────────────────────────────────────────────────────

    walk(seqs: Seq[], anchoredBefore = false, top = true): void {
        for (const seq of seqs) {
            this.runShapes(seq, anchoredBefore, top);
            let anchored = anchoredBefore;
            for (const atom of seq) {
                if (atom.node.t === "assert" && atom.node.value === "^" && !this.flags.includes("m")) anchored = true;
                this.visit(atom, anchored);
            }
        }
    }

    private visit(atom: Atom, anchored: boolean): void {
        const node = atom.node;
        if (node.t === "group") {
            this.walk(node.branches, anchored, false);
        } else if (node.t === "quant") {
            const inner = node.atom;
            if (node.max === Infinity && inner.node.t === "group" && !inner.node.lookaround) {
                const text = this.text(inner);
                if (this.repeats(inner) && !this.delimited(inner)) this.report("nested-quantifier", `${text} is repeated and repeats inside`);
                const branches = inner.node.branches;
                const firsts = branches.map((branch) => this.first(branch));
                let overlap = firsts.some((f) => f.nullable) && branches.length > 1;
                for (let a = 0; a < firsts.length && !overlap; a++)
                    for (let b = a + 1; b < firsts.length && !overlap; b++) overlap = intersects(firsts[a].chars, firsts[b].chars);
                if (overlap) this.report("overlapping-alternation", `${text} is repeated and its alternatives can start alike`);
            }
            this.visit(node.atom, anchored);
        }
    }
}

/** The super-linear shapes a regular expression's source has, by the rules above. */
export function superlinearShapes(source: string, flags = ""): Shape[] {
    const analyzer = new Analyzer(source, flags);
    analyzer.walk(new Reader(source).parse());
    return analyzer.shapes;
}
