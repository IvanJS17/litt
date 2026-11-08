import { describe, expect, it } from "vitest";
import { lawReferences, UNKNOWN_LAW } from "./legalReferences";

const CPEUM = "constitucion politica estados unidos mexicanos";
const STATES = [
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Coahuila", "Colima",
    "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "México", "Michoacán", "Morelos", "Nayarit", "Nuevo León",
    "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
    "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas", "Ciudad de México",
];
const ADJECTIVES = [
    "vecino", "vecina", "extranjero", "extranjera", "francesa", "argentino", "argentina", "peruana", "colombiano",
    "estadounidense", "español", "alemana", "chilena", "brasileño", "cubana", "en otro país", "anterior",
    "local", "estatal", "particular", "de otro estado", "del estado", "de Tlaxcala", "la de Tlaxcala", "el de Jalisco",
];
const lawOf = (text: string): string => {
    const keys = [...lawReferences(text)].filter((key) => key.startsWith("art:5@"));
    expect(keys.length, text).toBe(1);
    return keys[0].slice("art:5@".length);
};

describe("neutral connectors after «Constitución» never neutralize a qualifier", () => {
    const CONNECTORS = ["de acuerdo con", "de conformidad con", "de 1917"];
    const ARTICLES = ["", "la ", "el ", "lo "];

    it.each([
        ["«del país vecino»", "El artículo 5 de la Constitución del país vecino"],
        ["«del país» + nationality", "El artículo 5 de la Constitución del país argentino"],
        ["«del país» + state", "El artículo 5 de la Constitución del país de Tlaxcala"],
        ["«del país» in capitals", "El artículo 5 de la Constitución Del País Vecino"],
    ])("%s is not the federal constitution", (_name, text) => {
        expect(lawOf(text)).toBe(UNKNOWN_LAW);
    });

    it("«del país» and «de la República» are not neutral connectors any more, whatever follows", () => {
        for (const connector of ["del país", "de la República"])
            for (const tail of [...ADJECTIVES, ...STATES, "", "establece", "vecino establece"])
                for (const written of ["Constitución", "constitución", "Carta Magna"]) {
                    const text = `El artículo 5 de la ${written} ${connector} ${tail}`.trim();
                    expect(lawOf(text), text).not.toBe(CPEUM);
                }
    });

    it("no qualifier after «de acuerdo con», «de conformidad con» or «de 1917» gives the federal constitution", () => {
        let checked = 0;
        for (const connector of CONNECTORS)
            for (const article of ARTICLES)
                for (const tail of [...ADJECTIVES, ...STATES])
                    for (const written of ["Constitución", "constitución", "Carta Magna"])
                        for (const suffix of ["", " establece", ", dice"]) {
                            const text = `El artículo 5 de la ${written} ${connector} ${article}${tail}${suffix}`;
                            expect(lawOf(text), text).not.toBe(CPEUM);
                            checked += 1;
                        }
        expect(checked).toBeGreaterThan(5000);
    });

    it("the connectors still keep the federal constitution when nothing qualifies", () => {
        for (const text of [
            "El artículo 5 de la constitución de 1917.",
            "El artículo 5 de la constitución de 1917, establece",
            "El artículo 5 de la Constitución de 1917",
            "El artículo 5 de la constitución de 1917 establece",
            "El artículo 5 de la constitución de acuerdo con",
            "El artículo 5 de la Carta Magna de conformidad con.",
            "El artículo 5 de la constitución de conformidad con, además,",
        ])
            expect(lawOf(text), text).toBe(CPEUM);
    });
});
