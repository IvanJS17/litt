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

    describe("a law's name ends where the sentence's predicate begins (B1)", () => {
        const keys = (text: string, law: string | null = null) => [...lawReferences(text, law)];
        it("does not read the predicate after an abbreviation", () => {
            expect(keys("El artículo 5 de la LFT exige una jornada máxima.")).toEqual(["art:5@ley federal trabajo"]);
            expect(keys("El artículo 5 de la CPEUM establece que todos tienen derecho.")).toEqual([`art:5@${normalizeLaw("CPEUM")}`]);
            expect(keys("Según el artículo 5 de la Constitución Federal prohíbe esto.")).toEqual([`art:5@${normalizeLaw("CPEUM")}`]);
        });
        it("gives a full name with a predicate the key of the name alone", () => {
            const plain = keys("artículo 5 de la Ley Federal del Trabajo");
            expect(plain).toEqual(["art:5@ley federal trabajo"]);
            expect(keys("El artículo 5 de la Ley Federal del Trabajo establece que la jornada es de ocho horas.")).toEqual(plain);
            expect(keys("el artículo 5 de la Ley B exige una jornada máxima")).toEqual(["art:5@ley b"]);
        });
        it("keeps connectors and numbers inside the name, and stops at the first other lower-case word", () => {
            expect(keys("artículo 9 de la Ley del Impuesto sobre la Renta señala un plazo")).toEqual(["art:9@ley impuesto sobre renta"]);
            expect(keys("artículo 9 de la Ley del Impuesto sobre la Renta señala un plazo")).toEqual(keys("artículo 9 de la LISR"));
            expect(keys("artículo 3 del Código Nacional de Procedimientos Penales obliga al juez")).toEqual(keys("artículo 3 del CNPP"));
            expect(keys("artículo 3 de la Ley 1234 obliga")).toEqual(["art:3@ley 1234"]);
        });
        it("ends the name at punctuation right after it", () => {
            for (const written of ["de la LFT,", "de la LFT.", "(LFT)", "de la LFT;", "de la Ley Federal del Trabajo,", "de la Ley Federal del Trabajo."])
                expect(keys(`El artículo 5 ${written} dice`)).toEqual(["art:5@ley federal trabajo"]);
            expect(keys("artículo 5 de la Ley B, y exige")).toEqual(["art:5@ley b"]);
        });
        it("does not take a sentence that follows for the name", () => {
            expect(keys("artículo 5 de la Ley Federal del Trabajo. El artículo 6 de la Ley B.")).toEqual([
                "art:5@ley federal trabajo",
                "art:6@ley b",
            ]);
        });
        it("fails closed when no law can be delimited", () => {
            expect(keys("artículo 5 de la ley.", "ley b")).toEqual(["art:5@?"]);
            expect(keys("artículo 5 de la Ley exige algo", "ley b")).toEqual(["art:5@?"]);
            expect(keys("artículo 5 de lo que exige la LFT", "ley b")).toEqual(["art:5@?"]);
            expect(keys("artículo 5 de la Carta Fundamental exige")).toEqual(["art:5@?"]);
        });
    });

    describe("a lower-case name that is no alias is unverified; connectors complete the name (B1)", () => {
        const keys = (text: string, law: string | null = null) => [...lawReferences(text, law)];
        it("invents no identity for a lower-case name", () => {
            expect(keys("El artículo 5 de la ley exige que el patrón entregue equipo.")).toEqual(["art:5@?"]);
            expect(keys("El artículo 5 de la ley exige que el patrón entregue equipo.", "ley b")).toEqual(["art:5@?"]);
            expect(keys("artículo 5 de la ley federal del trabajo exige algo")).toEqual(["art:5@?"]);
            expect(keys("artículo 5 del código civil dice")).toEqual(["art:5@?"]);
        });
        it("still recognizes a lower-case alias", () => {
            expect(keys("artículo 5 de la lft exige algo")).toEqual(["art:5@ley federal trabajo"]);
            expect(keys("artículo 123 de la constitución exige algo")).toEqual([`art:123@${normalizeLaw("CPEUM")}`]);
            expect(keys("artículo 5 de la lfpc exige algo")).toEqual(["art:5@ley federal proteccion consumidor"]);
        });
        it("keeps «al», «a», «con», «por», «sin», «contra»… inside a name", () => {
            expect(keys("artículo 5 de la Ley Federal de Protección al Consumidor")).toEqual(["art:5@ley federal proteccion consumidor"]);
            expect(keys("artículo 5 de la Ley Federal de Protección a la Propiedad Industrial exige")).toEqual([
                "art:5@ley federal proteccion a propiedad industrial",
            ]);
            expect(keys("artículo 5 de la Ley Federal contra la Delincuencia Organizada exige")).toEqual([
                "art:5@ley federal contra delincuencia organizada",
            ]);
            expect(keys("artículo 5 de la Ley General de Salud Mental por Decreto exige")).toEqual(["art:5@ley general salud mental por decreto"]);
            expect(keys("artículo 5 de la Ley de Amparo, Reglamentaria de los artículos 103 y 107")[0]).toBe("art:5@ley amparo");
        });
        it("gives two protection laws two identities, and the aliases match their names", () => {
            const consumer = keys("artículo 5 de la Ley Federal de Protección al Consumidor");
            const industrial = keys("artículo 5 de la Ley Federal de Protección a la Propiedad Industrial");
            expect(consumer).not.toEqual(industrial);
            expect(keys("artículo 5 de la LFPPI")).toEqual(industrial);
            expect(keys("artículo 5 de la LFPC")).toEqual(consumer);
        });
        it("leaves a name cut by the word limit unverified, and a ten-word name that fits", () => {
            expect(keys("artículo 5 de la Ley Uno Dos Tres Cuatro Cinco Seis Siete Ocho Nueve Diez Once exige")).toEqual(["art:5@?"]);
            expect(keys("artículo 5 de la Ley Uno Dos Tres Cuatro Cinco Seis Siete Ocho Nueve exige")).toEqual([
                "art:5@ley uno dos tres cuatro cinco seis siete ocho nueve",
            ]);
            expect(keys("artículo 5 de la Ley Uno Dos Tres Cuatro Cinco Seis Siete Ocho Nueve Diez exige")).toEqual(["art:5@?"]);
        });
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

describe("a qualified constitution is not the federal one (B1) and final punctuation does not hide an alias (W4)", () => {
    const cpeum = normalizeLaw("CPEUM");
    const keys = (text: string) => [...lawReferences(text)];
    it.each([
        "¿Qué exige el artículo 5 de la Constitución local para los municipios?",
        "El artículo 5 de la constitución de Tlaxcala dice algo.",
        "El artículo 5 de la Constitución de Tlaxcala dice algo.",
        "El artículo 5 de la Constitución Política del Estado de Jalisco dice algo.",
        "El artículo 5 de la constitución política del estado de jalisco dice algo.",
        "El artículo 5 de la Constitución estatal dice algo.",
        "El artículo 5 de la constitución de la Ciudad de México dice algo.",
    ])("does not match the CPEUM: %s", (text) => {
        const found = keys(text);
        expect(found).toHaveLength(1);
        expect(found).not.toContain(`art:5@${cpeum}`);
        // Either unknown or a law of its own name, never the federal one.
        expect(found[0]).toMatch(/^art:5@(\?|constitucion .+)$/);
    });
    it.each([
        "El artículo 5 de la Constitución establece algo.",
        "El artículo 5 de la constitución exige algo.",
        "El artículo 5 de la Constitución Política de los Estados Unidos Mexicanos establece algo.",
        "El artículo 5 de la constitución política de los estados unidos mexicanos establece algo.",
        "El artículo 5 de la CPEUM establece algo.",
    ])("still matches the CPEUM: %s", (text) => {
        expect(keys(text)).toEqual([`art:5@${cpeum}`]);
    });
    it("recognizes an alias followed by the question's closing mark", () => {
        expect(keys("¿Qué dice el artículo 47 de la LFT?")).toEqual(["art:47@ley federal trabajo"]);
        expect(keys("¿Qué dice el artículo 47 de la Constitución?")).toEqual([`art:47@${cpeum}`]);
        expect(keys("¡Qué dice el artículo 47 de la Constitución!")).toEqual([`art:47@${cpeum}`]);
        expect(keys("(artículo 47 de la Constitución)")).toEqual([`art:47@${cpeum}`]);
    });
    it("keeps a qualified constitution unknown even before a closing mark", () => {
        expect(keys("¿Qué dice el artículo 5 de la Constitución local?")).toEqual(["art:5@?"]);
    });
});

describe("every loose alias of the federal constitution takes the same qualifier rule", () => {
    const cpeum = normalizeLaw("CPEUM");
    const keys = (text: string) => [...lawReferences(text)];
    it.each([
        "El artículo 5 de la Carta Magna local establece algo.",
        "El artículo 5 de la Carta Magna estatal establece algo.",
        "El artículo 5 de la Carta Magna de Tlaxcala establece algo.",
        "El artículo 5 de la carta magna del Estado de Jalisco establece algo.",
        "¿Qué dice el artículo 5 de la Carta Magna local?",
        "El artículo 5 constitucional de Tlaxcala establece algo.",
        "El artículo 5 constitucional local establece algo.",
        "El artículo 5 constitucional estatal establece algo.",
        "El artículo 5 constitucional del Estado de Jalisco establece algo.",
        "El artículo 5 constitucional de la Ciudad de México establece algo.",
        "El artículo 5 de la constitución de 1917 de Tlaxcala establece algo.",
    ])("is unknown, never the CPEUM: %s", (text) => {
        expect(keys(text)).toEqual(["art:5@?"]);
    });
    it.each([
        "El artículo 5 de la Carta Magna establece algo.",
        "¿Qué dice el artículo 5 de la Carta Magna?",
        "El artículo 5 constitucional establece algo.",
        "El artículo 5 constitucional, de acuerdo con la ley, establece algo.",
        "El artículo 5 de la Constitución de acuerdo con la ley establece algo.",
        "El artículo 5 de la Constitución de conformidad con la ley establece algo.",
        "El artículo 5 de la Constitución del país establece algo.",
        "El artículo 5 de la constitución de la república establece algo.",
        "El artículo 5 de la constitución de 1917 establece algo.",
        "El artículo 5 de la Constitución de 1917 establece algo.",
    ])("still matches the CPEUM: %s", (text) => {
        expect(keys(text)).toEqual([`art:5@${cpeum}`]);
    });
    it("never reads a capitalized «de 1917 de Tlaxcala» as the CPEUM (it stays a law of its own name)", () => {
        const found = keys("El artículo 5 de la Constitución de 1917 de Tlaxcala dice algo.");
        expect(found).toHaveLength(1);
        expect(found[0]).not.toBe(`art:5@${cpeum}`);
    });
    it("keeps a qualifier after a neutral connector unknown", () => {
        expect(keys("El artículo 5 de la Constitución del país de Tlaxcala dice algo.")).toEqual(["art:5@?"]);
        expect(keys("El artículo 5 de la Constitución de acuerdo con Tlaxcala dice algo.")).toEqual(["art:5@?"]);
    });
});

describe("hasKnownLaw", () => {
    it("is false only for an article of an unidentified law", () => {
        expect(hasKnownLaw("art:5@?")).toBe(false);
        expect(hasKnownLaw("art:5@ley b")).toBe(true);
        expect(hasKnownLaw("tesis:1")).toBe(true);
    });
});
