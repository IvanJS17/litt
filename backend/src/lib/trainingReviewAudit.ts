// LiTT training layer 3, bulk review designer (docs/training.md): the pure
// parts. A junior who designs a tabular review's questions gets a code-only
// review of them (lintColumns) and audits by hand a sample of its cells. The
// sample is drawn here, from a seed, so the same seed gives the same sample;
// no model is involved and no cell content leaves the cells.

import { createHash } from "node:crypto";
import type { TrainingAuditMark, TrainingLintWarning } from "@mike/contracts";

export type { TrainingAuditMark, TrainingLintWarning };

export const AUDIT_MARKS: readonly TrainingAuditMark[] = ["correct", "incomplete", "incorrect"];
/** An instruction shorter than this (after trimming) is a warning. */
export const AUDIT_MIN_INSTRUCTION_CHARS = 20;
/** The share of done cells audited, and the bounds of the sample. */
export const AUDIT_SAMPLE_SHARE = 0.1;
export const AUDIT_SAMPLE_MIN = 5;
export const AUDIT_SAMPLE_MAX = 20;
/** The note of a mark, and the mentor's note (matches the column checks). */
export const AUDIT_NOTE_MAX_CHARS = 500;

export function isAuditMark(value: unknown): value is TrainingAuditMark {
    return typeof value === "string" && (AUDIT_MARKS as readonly string[]).includes(value);
}

export type LintColumn = { index: number; name?: unknown; prompt?: unknown; format?: unknown };

const nameKey = (name: unknown) => (typeof name === "string" ? name.trim().replace(/\s+/gu, " ").toLowerCase() : "");

/**
 * The review of a review's questions with no model: repeated or empty names,
 * empty or very short instructions, columns without an answer format. They
 * are warnings; nothing is blocked. Ordered by column, then by code.
 */
export function lintColumns(columns: readonly LintColumn[]): TrainingLintWarning[] {
    const warnings: TrainingLintWarning[] = [];
    const firstByName = new Map<string, number>();
    for (const column of columns) {
        const key = nameKey(column.name);
        if (!key) {
            warnings.push({ code: "empty_name", column_index: column.index });
        } else {
            const first = firstByName.get(key);
            if (first === undefined) firstByName.set(key, column.index);
            else warnings.push({ code: "duplicate_name", column_index: column.index, other_index: first });
        }
        const prompt = typeof column.prompt === "string" ? column.prompt.trim() : "";
        if (!prompt) warnings.push({ code: "empty_instruction", column_index: column.index });
        else if ([...prompt].length < AUDIT_MIN_INSTRUCTION_CHARS)
            warnings.push({ code: "short_instruction", column_index: column.index });
        if (typeof column.format !== "string" || !column.format.trim())
            warnings.push({ code: "no_format", column_index: column.index });
    }
    return warnings;
}

/** How many cells to audit out of `done` finished ones: 10 %, between 5 and 20, never more than exist. */
export function sampleSize(done: number): number {
    if (!Number.isFinite(done) || done <= 0) return 0;
    const wanted = Math.min(AUDIT_SAMPLE_MAX, Math.max(AUDIT_SAMPLE_MIN, Math.ceil(done * AUDIT_SAMPLE_SHARE)));
    return Math.min(wanted, Math.floor(done));
}

export type SampleCandidate = { row_id: string; column_index: number };

/** A 32-bit seeded generator (mulberry32) started from a hash of the seed. */
export function seededRandom(seed: string): () => number {
    let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * A sample of `size` cells stratified by column: columns come in a seeded
 * order and each hands over one cell per round, so every column gets at
 * least one while `size` allows and the rest spread evenly. The input is put
 * in a canonical order first, so the draw depends only on the seed and on
 * which cells exist, never on the order they were read in.
 */
export function drawSample<T extends SampleCandidate>(cells: readonly T[], size: number, seed: string): T[] {
    const take = Math.min(Math.max(0, Math.floor(size)), cells.length);
    if (take === 0) return [];
    const random = seededRandom(seed);
    const canonical = [...cells].sort(
        (a, b) => a.column_index - b.column_index || (a.row_id < b.row_id ? -1 : a.row_id > b.row_id ? 1 : 0),
    );
    const byColumn = new Map<number, T[]>();
    for (const cell of canonical) byColumn.set(cell.column_index, [...(byColumn.get(cell.column_index) ?? []), cell]);
    const order = shuffled([...byColumn.keys()], random);
    const lanes = order.map((column) => shuffled(byColumn.get(column)!, random));
    const picked: T[] = [];
    for (let round = 0; picked.length < take; round++) {
        for (const lane of lanes) {
            if (round < lane.length && picked.length < take) picked.push(lane[round]);
        }
    }
    return picked;
}

/** A short hash of a cell as it is: tells later whether it changed, holds no content. */
export function cellDigest(content: unknown, citations: unknown): string {
    return createHash("sha256")
        .update(`${typeof content === "string" ? content : JSON.stringify(content ?? null)}\u0000${JSON.stringify(citations ?? null)}`)
        .digest("hex")
        .slice(0, 16);
}

export type AuditItem = {
    row_id: string;
    column_index: number;
    digest: string;
    mark?: TrainingAuditMark;
    note?: string;
    mentor_mark?: TrainingAuditMark;
};

export type ColumnTally = { column_index: number; marked: number; incorrect: number; incomplete: number };

/** The person's own marks counted by column (the mentor's corrections do not change them). */
export function tallyByColumn(items: readonly AuditItem[]): ColumnTally[] {
    const byColumn = new Map<number, ColumnTally>();
    for (const item of items) {
        const row = byColumn.get(item.column_index) ?? {
            column_index: item.column_index,
            marked: 0,
            incorrect: 0,
            incomplete: 0,
        };
        if (item.mark) row.marked += 1;
        if (item.mark === "incorrect") row.incorrect += 1;
        if (item.mark === "incomplete") row.incomplete += 1;
        byColumn.set(item.column_index, row);
    }
    return [...byColumn.values()].sort((a, b) => a.column_index - b.column_index);
}

/** Whether every sampled cell has its mark. */
export function allMarked(items: readonly AuditItem[]): boolean {
    return items.length > 0 && items.every((item) => !!item.mark);
}
