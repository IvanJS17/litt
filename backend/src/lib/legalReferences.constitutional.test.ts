import { describe, expect, it } from "vitest";
import { lawReferences, UNKNOWN_LAW } from "./legalReferences";

const CPEUM = "constitucion politica estados unidos mexicanos";
const STATES = [
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Coahuila", "Colima",
    "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "México", "Michoacán", "Morelos", "Nayarit", "Nuevo León",
    "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
    "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas", "Ciudad de México",
];
const lawOf = (text: string): string => {
    const keys = [...lawReferences(text)].filter((key) => key.startsWith("art:5@"));
    expect(keys.length, text).toBe(1);
    return keys[0].slice("art:5@".length);
};

describe("«constitucional de la Constitución de <estado>» is not the federal constitution", () => {
    it("holds for the 32 states, with and without «Política»", () => {
        expect(STATES).toHaveLength(32);
        for (const state of STATES)
            for (const head of ["Constitución", "Constitución Política", "constitución política", "Carta Magna"])
                for (const link of ["de la"])
                    for (const of of ["de", "del", "de la"]) {
                        const text = `El artículo 5 constitucional ${link} ${head} ${of} ${state} dice`;
                        expect(lawOf(text), text).not.toBe(CPEUM);
                    }
    });

    it("«de la Constitución» with a local qualifier or a state name", () => {
        for (const text of [
            "artículo 5 constitucional de la Constitución local",
            "artículo 5 constitucional de la Constitución Política del Estado de Jalisco",
            "artículo 5 constitucional de la Constitución Política de Tlaxcala",
            "artículo 5 constitucional de la Constitución de Tlaxcala",
        ])
            expect(lawOf(text), text).toBe(UNKNOWN_LAW);
    });

    it("keeps the federal constitution when «de la Constitución» is federal or unqualified", () => {
        for (const text of [
            "artículo 5 constitucional de la Constitución Política de los Estados Unidos Mexicanos",
            "artículo 5 constitucional de la Constitución",
            "artículo 5 constitucional de la Constitución, que dice",
            "artículo 5 constitucional de la Constitución establece",
            "artículo 5 constitucional",
            "artículo 5 constitucional y otros",
        ])
            expect(lawOf(text), text).toBe(CPEUM);
    });
});
