import { describe, expect, it } from "vitest";
import {
    canCreate,
    createBody,
    groupsFromProposal,
    movePage,
    pageRanges,
    setGroupIncluded,
    setGroupName,
    setGroupType,
    splitGroupAt,
    splitGroupName,
} from "./documentSplit";

const FALLBACK = "Documento";
const proposal = [
    { type: "Poder", identifier: null, pages: [3, 1, 2] },
    { type: "Constancia", identifier: "GACM701119BH5", pages: [4] },
    { type: null, identifier: null, pages: [5, 6] },
];
const start = () => groupsFromProposal(proposal, FALLBACK);

describe("names", () => {
    it("is the type and the identifier, the type alone, or the fallback", () => {
        expect(splitGroupName("Constancia", "GACM701119BH5", FALLBACK)).toBe("Constancia — GACM701119BH5");
        expect(splitGroupName("Poder", null, FALLBACK)).toBe("Poder");
        expect(splitGroupName(null, "x", FALLBACK)).toBe(FALLBACK);
    });
});

describe("groupsFromProposal", () => {
    it("checks every group, sorts its pages and proposes a name", () => {
        expect(start().map((g) => [g.id, g.include, g.name, g.pages])).toEqual([
            [1, true, "Poder", [1, 2, 3]],
            [2, true, "Constancia — GACM701119BH5", [4]],
            [3, true, FALLBACK, [5, 6]],
        ]);
    });
});

describe("pageRanges", () => {
    it("joins consecutive pages", () => {
        expect(pageRanges([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8");
        expect(pageRanges([4])).toBe("4");
        expect(pageRanges([])).toBe("");
    });
});

describe("movePage", () => {
    it("moves a page to another group and keeps both sorted", () => {
        const groups = movePage(start(), 3, 2, FALLBACK);
        expect(groups.map((g) => g.pages)).toEqual([[1, 2], [3, 4], [5, 6]]);
    });

    it("drops a group that loses its last page", () => {
        const groups = movePage(start(), 4, 3, FALLBACK);
        expect(groups.map((g) => g.pages)).toEqual([[1, 2, 3], [4, 5, 6]]);
    });

    it("puts a page in a new group of its own, without a type", () => {
        const groups = movePage(start(), 2, null, FALLBACK);
        expect(groups.map((g) => g.pages)).toEqual([[1, 3], [2], [4], [5, 6]].sort((a, b) => a[0] - b[0]));
        const created = groups.find((g) => g.pages[0] === 2);
        expect(created).toMatchObject({ type: null, name: FALLBACK, include: true, nameEdited: false });
        expect(new Set(groups.map((g) => g.id)).size).toBe(groups.length);
    });

    it("does nothing for the group the page is already in or a page that does not exist", () => {
        expect(movePage(start(), 1, 1, FALLBACK)).toEqual(start());
        expect(movePage(start(), 99, 2, FALLBACK)).toEqual(start());
    });
});

describe("splitGroupAt", () => {
    it("makes a new group of the page and the ones after it", () => {
        const groups = splitGroupAt(start(), 1, 2, FALLBACK);
        expect(groups.map((g) => g.pages)).toEqual([[1], [2, 3], [4], [5, 6]]);
        expect(groups[1]).toMatchObject({ type: null, name: FALLBACK });
        expect(groups[0]).toMatchObject({ type: "Poder" });
    });

    it("does nothing at the first page of a group, for a page outside it or for an unknown group", () => {
        expect(splitGroupAt(start(), 1, 1, FALLBACK)).toEqual(start());
        expect(splitGroupAt(start(), 1, 5, FALLBACK)).toEqual(start());
        expect(splitGroupAt(start(), 9, 1, FALLBACK)).toEqual(start());
    });
});

describe("editing a group", () => {
    it("renames from the type until the person types a name", () => {
        let groups = setGroupType(start(), 1, "Acta protocolizada", FALLBACK);
        expect(groups[0]).toMatchObject({ type: "Acta protocolizada", name: "Acta protocolizada" });
        groups = setGroupName(groups, 1, "Mi acta");
        expect(groups[0]).toMatchObject({ name: "Mi acta", nameEdited: true });
        groups = setGroupType(groups, 1, "Poder", FALLBACK);
        expect(groups[0]).toMatchObject({ type: "Poder", name: "Mi acta" });
        expect(setGroupType(start(), 1, null, FALLBACK)[0].name).toBe(FALLBACK);
    });

    it("keeps the identifier in the name when the type changes", () => {
        expect(setGroupType(start(), 2, "Credencial para votar (INE)", FALLBACK)[1].name).toBe("Credencial para votar (INE) — GACM701119BH5");
    });
});

describe("what is created", () => {
    it("is only the checked groups, with trimmed names and their types", () => {
        let groups = setGroupIncluded(start(), 3, false);
        groups = setGroupName(groups, 1, "  Poder de Ana  ");
        expect(createBody(groups)).toEqual([
            { pages: [1, 2, 3], name: "Poder de Ana", type: "Poder" },
            { pages: [4], name: "Constancia — GACM701119BH5", type: "Constancia" },
        ]);
        expect(canCreate(groups)).toBe(true);
    });

    it("cannot create with nothing checked or a checked group without a name", () => {
        const none = start().map((g) => ({ ...g, include: false }));
        expect(canCreate(none)).toBe(false);
        expect(canCreate(setGroupName(start(), 1, "   "))).toBe(false);
        // An unchecked group without a name does not block the others.
        expect(canCreate(setGroupIncluded(setGroupName(start(), 1, ""), 1, false))).toBe(true);
    });
});
