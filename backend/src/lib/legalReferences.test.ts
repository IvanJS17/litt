import { describe, expect, it } from "vitest";
import { hasKnownLaw, lawOfTitle, lawReferences, legalReferences, normalizeLaw } from "./legalReferences";

describe("legalReferences (number only, unchanged)", () => {
    it("still compares numbers without the law", () => {
        expect([...legalReferences("artículo 5 de la Ley A")]).toEqual(["art:5"]);
        expect(legalReferences("artículo 5 de la Ley B")).toEqual(legalReferences("art. 5 de la Ley A"));
    });
});

describe("normalizeLaw", () => {
    it("gives one identity to a law's name, accents, case and abbreviation", () => {
        const lft = normalizeLaw("Ley Federal del Trabajo");
        expect(lft).toBe("ley federal trabajo");
        expect(normalizeLaw("LEY FEDERAL DEL TRABAJO")).toBe(lft);
        expect(normalizeLaw("LFT")).toBe(lft);
        const constitution = normalizeLaw("Constitución Política de los Estados Unidos Mexicanos");
        expect(normalizeLaw("CPEUM")).toBe(constitution);
        expect(normalizeLaw("Constitución")).toBe(constitution);
        expect(normalizeLaw("la Carta Magna")).toBe(constitution);
    });

    it("never merges two laws, and names none for a bare head or other text", () => {
        expect(normalizeLaw("Constitución Política de la Ciudad de México")).not.toBe(normalizeLaw("CPEUM"));
        expect(normalizeLaw("Ley A")).not.toBe(normalizeLaw("Ley B"));
        expect(normalizeLaw("Código Civil")).not.toBe(normalizeLaw("CCF"));
        for (const text of ["", "la ley", "esta ley", "el código", "este contrato", "ley"]) expect(normalizeLaw(text)).toBeNull();
    });
});

describe("lawOfTitle", () => {
    it("reads the law a document is from its title", () => {
        expect(lawOfTitle("Ley Federal del Trabajo.pdf")).toBe(normalizeLaw("LFT"));
        expect(lawOfTitle("LFT.docx")).toBe(normalizeLaw("LFT"));
        expect(lawOfTitle("contrato_arrendamiento.docx")).toBeNull();
        expect(lawOfTitle(null)).toBeNull();
        expect(lawOfTitle("")).toBeNull();
    });
});

describe("lawReferences", () => {
    it("ties each article to the law named right after it", () => {
        expect([...lawReferences("artículo 5 de la Ley Federal del Trabajo")]).toEqual(["art:5@ley federal trabajo"]);
        expect([...lawReferences("art. 5 LFT")]).toEqual(["art:5@ley federal trabajo"]);
        expect([...lawReferences("el artículo 5 constitucional")]).toEqual([`art:5@${normalizeLaw("CPEUM")}`]);
        expect([...lawReferences("artículos 5 y 6 del Código Civil Federal")].sort()).toEqual([
            "art:5@codigo civil federal",
            "art:6@codigo civil federal",
        ]);
    });

    it("ties fractions, in both orders, to the law", () => {
        expect(lawReferences("artículo 27, fracción IV, de la LFT")).toEqual(
            new Set(["art:27@ley federal trabajo", "art:27:fr:4@ley federal trabajo"]),
        );
        expect(lawReferences("la fracción VII del artículo 123 de la CPEUM")).toContain(
            `art:123:fr:7@${normalizeLaw("CPEUM")}`,
        );
    });

    it("stops the law's name at the sentence's own words", () => {
        expect([...lawReferences("artículo 5 de la Ley B que establece el plazo")]).toEqual(["art:5@ley b"]);
        expect([...lawReferences("artículo 5 de la Ley B, y el plazo")]).toEqual(["art:5@ley b"]);
    });

    it("falls back to the law of the document, and to «unknown» without one", () => {
        expect([...lawReferences("Artículo 5. Texto", "ley b")]).toEqual(["art:5@ley b"]);
        expect([...lawReferences("Artículo 5. Texto")]).toEqual(["art:5@?"]);
        // A law named in the text wins over the document's.
        expect([...lawReferences("artículo 14 de la Ley A", "ley b")]).toEqual(["art:14@ley a"]);
        // «de …» that names no law is another source: not the document's law.
        expect([...lawReferences("artículo 5 de este contrato", "ley b")]).toEqual(["art:5@?"]);
        expect([...lawReferences("artículo 5 de la ley", "ley b")]).toEqual(["art:5@?"]);
        expect([...lawReferences("artículo 5 establece", "ley b")]).toEqual(["art:5@ley b"]);
    });

    it("keeps theses and registry numbers as they are", () => {
        const found = lawReferences("tesis 1a./J. 12/2020 y registro 2021234");
        expect(found).toEqual(new Set(["tesis:1a./j.12/2020", "registro:2021234"]));
        expect([...found].every(hasKnownLaw)).toBe(true);
    });
});

describe("hasKnownLaw", () => {
    it("is false only for an article of an unidentified law", () => {
        expect(hasKnownLaw("art:5@?")).toBe(false);
        expect(hasKnownLaw("art:5@ley b")).toBe(true);
        expect(hasKnownLaw("tesis:1")).toBe(true);
    });
});
