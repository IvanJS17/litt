import { describe, expect, it } from "vitest";
import { legalReferences } from "./legalReferences";

describe("legalReferences (number only)", () => {
    it("still compares numbers without the law", () => {
        expect([...legalReferences("artículo 5 de la Ley A")]).toEqual(["art:5"]);
        expect(legalReferences("artículo 5 de la Ley B")).toEqual(legalReferences("art. 5 de la Ley A"));
    });
});
