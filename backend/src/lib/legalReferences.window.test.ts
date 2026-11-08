import { describe, expect, it } from "vitest";
import { lawReferences } from "./legalReferences";
import * as before from "./__tests__/legalReferences.before";

// lawNamedAt tokenized the whole tail of the text for each article: quadratic. It reads a
// bounded window now (grown only when the name can still go on), with the same result.
const SENTENCES = [
    "El artículo 5 de la Ley Federal del Trabajo dice algo. ",
    "Ver art. 14 de la Constitución, y el artículo 7 del Código Civil Federal; ",
    "El artículo 3 según la ley. ",
    "El artículo 9 de la Ley del Impuesto sobre la Renta y de Servicios Conexos de la Federación Mexicana Vigente Hoy. ",
    "Artículo 12 de la Constitución Política de los Estados Unidos Mexicanos. ",
];
const build = (size: number): string => {
    let text = "";
    for (let i = 0; text.length < size; i++) text += SENTENCES[i % SENTENCES.length];
    return text.slice(0, size);
};
const timed = (run: () => unknown): number => {
    const started = performance.now();
    run();
    return performance.now() - started;
};

describe("law names are read from a bounded window", () => {
    it("60 000 characters with many articles take under a second", () => {
        const text = build(60_000);
        expect(text.match(/art/gi)!.length).toBeGreaterThan(1_000);
        expect(timed(() => lawReferences(text))).toBeLessThan(1_000);
    });

    it("grows linearly: double the text is not four times the time", () => {
        lawReferences(build(30_000));
        const small = Math.max(timed(() => lawReferences(build(30_000))), 5);
        const large = timed(() => lawReferences(build(120_000)));
        expect(large).toBeLessThan(small * 12);
    });

    it("gives the result of the previous module", () => {
        for (const size of [500, 5_000, 30_000, 60_000]) {
            const text = build(size);
            for (const source of [null, "ley sede"]) expect([...lawReferences(text, source)]).toEqual([...before.lawReferences(text, source)]);
        }
    });

    it("a name longer than the window, a run of connectors and a name ending the text give the previous result", () => {
        const long = "Ley " + Array.from({ length: 12 }, (_, i) => `Palabra${i}`).join(" ");
        const connectors = "Ley " + "de ".repeat(120) + "Nombre";
        const texts = [
            `artículo 5 de la ${long}`, `artículo 5 de la ${long}. Otro`, `artículo 5 de la ${connectors}`,
            `artículo 5 de la ${connectors} Largo`, `artículo 5 de la Ley ${"Abc ".repeat(80)}`,
            `artículo 5 de la Ley ${"Abc ".repeat(80)}x ${"y ".repeat(500)}artículo 6 de la LFT`,
            `artículo 5 de la ${"x".repeat(300)} Ley Federal`, `artículo 5 de la Ley Federal del Trabajo${" ".repeat(900)}Mexicana`,
            `artículo 5 de la Constitución${" ".repeat(900)}de Tlaxcala`, `artículo 5 de la Constitución ${"de ".repeat(200)}Tlaxcala`,
        ];
        for (const text of texts) for (const source of [null, "ley sede"])
            expect([...lawReferences(text, source)], text.slice(0, 80)).toEqual([...before.lawReferences(text, source)]);
    });
});
