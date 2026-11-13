import type { DocumentSplitCreateGroup, DocumentSplitGroup } from "@mike/contracts";

/**
 * The editable preview of "Separar expediente". Pure functions over plain data:
 * nothing here reads a translated label, and nothing is created until the
 * person confirms (docs/document-split.md). Adjusting is free; only the first
 * classification is paid.
 */
export type EditableSplitGroup = {
    /** Stable for the life of the dialog; never shown. */
    id: number;
    /** A group left unchecked is not created (blank sheets, for example). */
    include: boolean;
    /** A name from the list of types, or null for "no type". */
    type: string | null;
    identifier: string | null;
    name: string;
    /** The person typed the name: changing the type no longer renames it. */
    nameEdited: boolean;
    /** 1-indexed, ascending. */
    pages: number[];
};

/** "Constancia de situación fiscal — GACM701119BH5", or just the type, or `fallback` when there is neither. */
export function splitGroupName(type: string | null, identifier: string | null, fallback: string): string {
    if (!type) return fallback;
    return identifier ? `${type} — ${identifier}` : type;
}

export function groupsFromProposal(groups: readonly DocumentSplitGroup[], fallbackName: string): EditableSplitGroup[] {
    return groups.map((group, index) => ({
        id: index + 1,
        include: true,
        type: group.type,
        identifier: group.identifier,
        name: splitGroupName(group.type, group.identifier, fallbackName),
        nameEdited: false,
        pages: [...group.pages].sort((a, b) => a - b),
    }));
}

/** "1–3, 5, 7–8" for ascending pages. */
export function pageRanges(pages: readonly number[]): string {
    const ranges: string[] = [];
    for (let i = 0; i < pages.length; i++) {
        const first = pages[i];
        while (i + 1 < pages.length && pages[i + 1] === pages[i] + 1) i++;
        ranges.push(first === pages[i] ? `${first}` : `${first}–${pages[i]}`);
    }
    return ranges.join(", ");
}

const byFirstPage = (a: EditableSplitGroup, b: EditableSplitGroup) => a.pages[0] - b.pages[0];
const nextId = (groups: readonly EditableSplitGroup[]) => groups.reduce((max, g) => Math.max(max, g.id), 0) + 1;

/** Move one page to another group, or (`toGroupId` null) into a new group of its own. A group left empty disappears. */
export function movePage(groups: readonly EditableSplitGroup[], page: number, toGroupId: number | null, fallbackName: string): EditableSplitGroup[] {
    const from = groups.find((g) => g.pages.includes(page));
    if (!from || from.id === toGroupId) return [...groups];
    const rest = groups
        .map((g) => (g.id === from.id ? { ...g, pages: g.pages.filter((p) => p !== page) } : g))
        .map((g) => (g.id === toGroupId ? { ...g, pages: [...g.pages, page].sort((a, b) => a - b) } : g))
        .filter((g) => g.pages.length > 0);
    if (toGroupId === null)
        rest.push({ id: nextId(groups), include: true, type: null, identifier: null, name: fallbackName, nameEdited: false, pages: [page] });
    return rest.sort(byFirstPage);
}

/** Split a group before `page`: that page and the ones after it become a new group without a type. */
export function splitGroupAt(groups: readonly EditableSplitGroup[], groupId: number, page: number, fallbackName: string): EditableSplitGroup[] {
    const group = groups.find((g) => g.id === groupId);
    if (!group || !group.pages.includes(page) || page === group.pages[0]) return [...groups];
    const kept = group.pages.filter((p) => p < page);
    const moved = group.pages.filter((p) => p >= page);
    return [
        ...groups.map((g) => (g.id === groupId ? { ...g, pages: kept } : g)),
        { id: nextId(groups), include: true, type: null, identifier: null, name: fallbackName, nameEdited: false, pages: moved },
    ].sort(byFirstPage);
}

export function setGroupType(groups: readonly EditableSplitGroup[], groupId: number, type: string | null, fallbackName: string): EditableSplitGroup[] {
    return groups.map((g) =>
        g.id !== groupId
            ? g
            : { ...g, type, name: g.nameEdited ? g.name : splitGroupName(type, g.identifier, fallbackName) },
    );
}

export function setGroupName(groups: readonly EditableSplitGroup[], groupId: number, name: string): EditableSplitGroup[] {
    return groups.map((g) => (g.id === groupId ? { ...g, name, nameEdited: true } : g));
}

export function setGroupIncluded(groups: readonly EditableSplitGroup[], groupId: number, include: boolean): EditableSplitGroup[] {
    return groups.map((g) => (g.id === groupId ? { ...g, include } : g));
}

/** What the server is asked to create: only the checked groups, with a name. */
export function createBody(groups: readonly EditableSplitGroup[]): DocumentSplitCreateGroup[] {
    return groups
        .filter((g) => g.include && g.pages.length > 0)
        .map((g) => ({ pages: g.pages, name: g.name.trim(), type: g.type }));
}

/** The dialog can create when at least one group is checked and every checked group has a name. */
export function canCreate(groups: readonly EditableSplitGroup[]): boolean {
    const body = createBody(groups);
    return body.length > 0 && body.every((g) => g.name.length > 0);
}
