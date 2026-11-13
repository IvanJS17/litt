import type { VersionCompareSide } from "@mike/contracts";
import type { EqualRun, TextChange, TextComparison } from "./textDiff";

/** `assistant_edit` and `generated` are the AI's; every other source is a person's. */
const AI_SOURCES: ReadonlySet<string> = new Set(["assistant_edit", "generated"]);

export type VersionAuthor = "ai" | "person";

/** Read from the version's `source` only, never from its text. */
export function versionAuthor(source: string | null | undefined): VersionAuthor {
    return source != null && AI_SOURCES.has(source) ? "ai" : "person";
}

export type CompareBlock =
    | { kind: "gap"; key: string; count: number; withChanges: boolean; hidden: CompareBlock[] }
    | { kind: "context"; key: string; oldNo: number; newNo: number; text: string }
    | { kind: "change"; key: string; change: TextChange };

/** Unchanged lines kept around each shown change, as in a pull request. */
export const CONTEXT_LINES = 3;

function linesIn(item: EqualRun | TextChange): number {
    return item.kind === "equal"
        ? item.lines.length
        : Math.max(item.removed.length, item.added.length);
}

/**
 * What to draw: every shown change with a few unchanged lines around it, and
 * a gap for the rest. A change the filter hides counts as part of a gap.
 */
export function compareBlocks(
    comparison: TextComparison,
    isShown: (change: TextChange) => boolean,
): CompareBlock[] {
    const { items } = comparison;
    const shown = (index: number) => {
        const item = items[index];
        return item?.kind === "change" && isShown(item);
    };
    const blocks: CompareBlock[] = [];
    let hidden = 0;
    // What the gap stands for, so the reader can open it.
    let folded: CompareBlock[] = [];
    const flush = (key: string) => {
        if (hidden > 0)
            blocks.push({
                kind: "gap",
                key: `gap-${key}`,
                count: hidden,
                // A gap that also folds a change the filter left out is not only "unchanged lines".
                withChanges: folded.some((block) => block.kind === "change"),
                hidden: folded,
            });
        hidden = 0;
        folded = [];
    };
    items.forEach((item, index) => {
        if (item.kind === "change") {
            if (!shown(index)) {
                hidden += linesIn(item);
                folded.push({ kind: "change", key: `change-${item.index}`, change: item });
                return;
            }
            flush(String(index));
            blocks.push({ kind: "change", key: `change-${item.index}`, change: item });
            return;
        }
        const before = shown(index - 1) ? CONTEXT_LINES : 0;
        const after = shown(index + 1) ? CONTEXT_LINES : 0;
        const keepAll = item.lines.length <= before + after;
        item.lines.forEach((line, at) => {
            const keep =
                keepAll ||
                at < before ||
                at >= item.lines.length - after;
            const block: CompareBlock = {
                kind: "context",
                key: `ctx-${line.oldNo}-${line.newNo}`,
                ...line,
            };
            if (!keep) {
                hidden += 1;
                folded.push(block);
                return;
            }
            flush(`${index}-${at}`);
            blocks.push(block);
        });
    });
    flush("end");
    return blocks;
}

export interface ChangeGroup {
    /** The section title in a .md, null for the text before the first one. */
    heading: string | null;
    changes: TextChange[];
}

/** For the list of changes: by nearest `#` title in a .md, otherwise one group. */
export function groupChanges(changes: TextChange[], byHeading: boolean): ChangeGroup[] {
    if (!byHeading) return changes.length ? [{ heading: null, changes }] : [];
    const groups: ChangeGroup[] = [];
    for (const change of changes) {
        const last = groups[groups.length - 1];
        if (last && last.heading === change.heading) last.changes.push(change);
        else groups.push({ heading: change.heading, changes: [change] });
    }
    return groups;
}

export type CompareReadiness =
    | { kind: "ready" }
    | { kind: "no_text" }
    | { kind: "too_large" };

/** Whether both sides can be diffed at all, before any text is read. */
export function compareReadiness(
    base: Pick<VersionCompareSide, "text_status" | "text" | "too_large">,
    head: Pick<VersionCompareSide, "text_status" | "text" | "too_large">,
): CompareReadiness {
    const sides = [base, head];
    if (sides.some((side) => side.text_status !== "ready")) return { kind: "no_text" };
    if (sides.some((side) => side.too_large)) return { kind: "too_large" };
    if (sides.some((side) => side.text === null)) return { kind: "no_text" };
    return { kind: "ready" };
}

export function isMarkdownName(filename: string | null | undefined): boolean {
    return /\.(md|markdown)$/i.test(filename ?? "");
}
