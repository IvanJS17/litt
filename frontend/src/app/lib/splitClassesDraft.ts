import type { SplitClass } from "@mike/contracts";

/**
 * The editor of the list of document types for splitting a case file
 * (Settings; docs/document-split.md). The limits mirror the server's
 * (`lib/ocr/splitClasses.ts`), which is what actually decides.
 */
export const SPLIT_NAME_MAX = 80;
export const SPLIT_DESCRIPTION_MAX = 800;
export const SPLIT_IDENTIFIER_MAX = 80;

/** A row being edited. `key` only keeps React's identity while rows are added and removed. */
export type DraftClass = { key: number; name: string; description: string; identifier: string };

export function draftFrom(classes: readonly SplitClass[], firstKey = 1): DraftClass[] {
    return classes.map((c, index) => ({ key: firstKey + index, name: c.name, description: c.description, identifier: c.identifier ?? "" }));
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** What is sent: trimmed, with an empty identifier left out. */
export function draftToClasses(draft: readonly DraftClass[]): SplitClass[] {
    return draft.map((row) => {
        const identifier = squash(row.identifier);
        return { name: squash(row.name), description: squash(row.description), ...(identifier ? { identifier } : {}) };
    });
}

export type DraftProblem = "empty" | "name" | "description" | "identifier" | "duplicate" | "reserved" | "too_many";

/** The first thing wrong with the list, or null. Decided by this code, shown by the catalog. */
export function draftProblem(draft: readonly DraftClass[], max: number): DraftProblem | null {
    if (draft.length === 0) return "empty";
    if (draft.length > max) return "too_many";
    const seen = new Set<string>();
    for (const row of draftToClasses(draft)) {
        if (!row.name || row.name.length > SPLIT_NAME_MAX) return "name";
        if (!row.description || row.description.length > SPLIT_DESCRIPTION_MAX) return "description";
        if ((row.identifier?.length ?? 0) > SPLIT_IDENTIFIER_MAX) return "identifier";
        const key = row.name.toLowerCase();
        if (key === "uncategorized") return "reserved";
        if (seen.has(key)) return "duplicate";
        seen.add(key);
    }
    return null;
}

const same = (a: readonly SplitClass[], b: readonly SplitClass[]) => JSON.stringify(a) === JSON.stringify(b);

/** True when the draft is exactly the built-in list: it is then saved as "no list of its own". */
export function isBuiltIn(draft: readonly DraftClass[], defaults: readonly SplitClass[]): boolean {
    return same(draftToClasses(draft), draftToClasses(draftFrom(defaults)));
}

/** True when the draft differs from what is saved (compared as it would be sent). */
export function isChanged(draft: readonly DraftClass[], saved: readonly SplitClass[]): boolean {
    return !same(draftToClasses(draft), draftToClasses(draftFrom(saved)));
}
