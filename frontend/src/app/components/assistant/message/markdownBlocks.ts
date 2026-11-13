/**
 * Splits streamed Markdown into top-level blocks that parse the same alone as
 * inside the whole text, so a block that has closed can be left untouched
 * while only the open one is parsed again.
 *
 * A boundary is a blank line outside a code fence or a `$$` block whose next
 * non-blank line cannot continue what came before: it starts in the first
 * column, is not a table row or a quote, and is not a list item when the
 * block before holds a list (a loose list would otherwise restart its
 * numbering). Text with link reference definitions or footnotes, whose
 * meaning reaches across blocks, is never split. The pieces joined give the
 * text back exactly.
 */

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
// A label stops at the next bracket either way, so no attempt rescans the
// text after it: the test stays linear on streamed (model-written) text.
const CROSS_BLOCK_SYNTAX = /^ {0,3}\[[^[\]]+\]:\s*\S|\[\^[^[\]\s]+\]/m;

function safeBoundary(blockHasList: boolean, next: string): boolean {
    if (next.length === 0 || /^\s/.test(next)) return false;
    if (/^[>|]/.test(next)) return false;
    if (LIST_ITEM.test(next) && blockHasList) {
        return false;
    }
    return true;
}

export function splitMarkdownBlocks(text: string): string[] {
    if (!text.includes("\n\n") || CROSS_BLOCK_SYNTAX.test(text)) return [text];
    const lines = text.split("\n");
    const pieces: string[] = [];
    let start = 0;
    let fence: string | null = null;
    let inMath = false;
    // Whether the block being built holds a list item, kept as lines go by so a
    // boundary check never rescans the block (linear on long text).
    let blockHasList = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (LIST_ITEM.test(line)) blockHasList = true;
        if (fence !== null) {
            const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
            if (close.test(line)) fence = null;
            continue;
        }
        const open = FENCE_OPEN.exec(line);
        if (open && !inMath) {
            fence = open[1];
            continue;
        }
        if (((line.match(/\$\$/g) ?? []).length & 1) === 1) inMath = !inMath;
        if (inMath || line.trim() !== "") continue;
        let next = i + 1;
        while (next < lines.length && lines[next].trim() === "") next++;
        if (next >= lines.length) break;
        if (safeBoundary(blockHasList, lines[next])) {
            pieces.push(lines.slice(start, next).join("\n") + "\n");
            start = next;
            blockHasList = false;
        }
        // Every line up to `next` is blank and would reach the same verdict:
        // skip them, or a long run of blank lines is scanned once per line.
        i = next - 1;
    }
    pieces.push(lines.slice(start).join("\n"));
    return pieces;
}
