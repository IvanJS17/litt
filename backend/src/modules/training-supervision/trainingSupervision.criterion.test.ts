import { describe, expect, it } from "vitest";
import { computeCriterionLines, type NoteRow } from "./trainingSupervision.signals";

// The review lines computed from the notes alone (no model): hints, the
// thermometer against the contrast's verdict, the basis, and the
// counterparty rounds. A line says what happened; it ranks nothing.

let n = 0;
function note(over: Partial<NoteRow> = {}): NoteRow {
    n += 1;
    return {
        id: `n${n}`,
        org_id: "o",
        trainee_user_id: "u",
        chat_id: "c",
        word_chat_id: null,
        tabular_chat_id: null,
        message_id: `m${n}`,
        attempt: "intento",
        contrast: null,
        contrast_status: "ready",
        created_at: new Date(1_700_000_000_000 + n * 1000).toISOString(),
        ...over,
    };
}
const hint = (step: number) => note({ mode: "hint", step, contrast_status: "skipped" });
const turn = (step: number) => note({ mode: "counterpart", step, contrast_status: "skipped" });
const close = (step: number) => note({ mode: "counterpart_close", step });

describe("computeCriterionLines", () => {
    it("says nothing about a chat of plain turns", () => {
        expect(computeCriterionLines([note(), note({ verdict: "coincide", verdict_source: "contrast", foundation: "solid", confidence: 3 })])).toEqual({
            lines: [],
            hints_used: 0,
            max_hint_level: 0,
            counterpart_rounds: 0,
            counterpart_closed: 0,
        });
    });

    it("records each hint, and whether the pupil then sent the question", () => {
        const [h1, h2] = [hint(1), hint(2)];
        const sent = computeCriterionLines([h1, h2, note()]);
        expect(sent.lines).toEqual([
            { source: "hint", text: "Pidió pista de nivel 1 antes de enviar", ref: h1.id },
            { source: "hint", text: "Pidió pista de nivel 2 antes de enviar", ref: h2.id },
        ]);
        expect(sent).toMatchObject({ hints_used: 2, max_hint_level: 2 });
        const abandoned = computeCriterionLines([hint(1)]);
        expect(abandoned.lines[0].text).toBe("Pidió pista de nivel 1");
    });

    it("keeps the newest hint lines when there are many ladders", () => {
        const notes = Array.from({ length: 5 }, () => [hint(1), hint(2), hint(3), note()]).flat();
        const { lines, hints_used } = computeCriterionLines(notes);
        expect(hints_used).toBe(15);
        expect(lines.filter((line) => line.source === "hint")).toHaveLength(6);
    });

    it("counts a round closed or left open, with the turns it took", () => {
        const closed = computeCriterionLines([turn(1), turn(2), close(2)]);
        expect(closed.lines).toEqual([expect.objectContaining({ source: "counterpart", text: "Cerró una ronda con la contraparte (2 turnos)" })]);
        expect(closed).toMatchObject({ counterpart_rounds: 1, counterpart_closed: 1 });

        const open = computeCriterionLines([turn(1), note()]);
        expect(open.lines).toEqual([expect.objectContaining({ text: "Probó 1 turno con la contraparte y no cerró la ronda" })]);
        expect(open).toMatchObject({ counterpart_rounds: 1, counterpart_closed: 0 });

        const two = computeCriterionLines([turn(1), close(1), turn(1), turn(2)]);
        expect(two).toMatchObject({ counterpart_rounds: 2, counterpart_closed: 1 });
    });

    it("points at a mark that the AI contrast did not bear out, in either direction, saying whose verdict it is", () => {
        const sure = note({ confidence: 4, verdict: "no_coincide", verdict_source: "contrast", foundation: "wrong" });
        const guess = note({ confidence: 1, verdict: "coincide", verdict_source: "contrast", foundation: "solid" });
        const fine = note({ confidence: 4, verdict: "coincide", verdict_source: "contrast", foundation: "solid" });
        const { lines } = computeCriterionLines([sure, guess, fine]);
        expect(lines).toEqual([
            { source: "confidence", text: "Marcó «Seguro» y, según el contraste de la IA, su planteamiento no coincidió", ref: sure.id },
            { source: "confidence", text: "Marcó «Casi adivino» y, según el contraste de la IA, su planteamiento coincidió", ref: guess.id },
        ]);
    });

    it("flags a matching conclusion on a weak or wrong basis, unless the mentor decided the verdict", () => {
        const weak = note({ verdict: "coincide", verdict_source: "contrast", foundation: "weak" });
        const wrong = note({ verdict: "coincide", verdict_source: "contrast", foundation: "wrong" });
        const corrected = note({ verdict: "coincide", verdict_source: "mentor", foundation: "wrong" });
        const solid = note({ verdict: "coincide", verdict_source: "contrast", foundation: "solid" });
        const { lines } = computeCriterionLines([weak, wrong, corrected, solid]);
        const foundation = lines.filter((line) => line.source === "foundation");
        expect(foundation.map((line) => [line.text, line.ref])).toEqual([
            ["Su conclusión coincidió, pero su fundamento fue débil según el contraste de la IA", weak.id],
            ["Su conclusión coincidió, pero su fundamento fue equivocado según el contraste de la IA", wrong.id],
        ]);
    });

    it("never puts a number, a verdict or a hint's text on a line", () => {
        const { lines } = computeCriterionLines([hint(1), note({ confidence: 4, verdict: "no_coincide", verdict_source: "contrast" }), turn(1), close(1)]);
        for (const line of lines) {
            expect(Object.keys(line).sort()).toEqual(["ref", "source", "text"]);
            expect(line.text).not.toMatch(/\d{2,}|score|puntaje|%/);
        }
    });
});
