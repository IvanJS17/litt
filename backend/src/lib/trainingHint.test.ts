import { describe, expect, it } from "vitest";
import { memoryDb } from "../__tests__/helpers/memoryDb";
import {
    UNVERIFIED_LEGAL_FOOTER,
    counterpartState,
    ladderOf,
    loadLadderNotes,
    loadLadderNotesAnywhere,
    nextHintLevel,
    unverifiedLegalFooter,
    type LadderNote,
} from "./trainingHint";

const n = (mode: LadderNote["mode"] = null, step: number | null = null, attempt = "x"): LadderNote => ({ mode, step, attempt });
/** Newest first, as the ladder reads them. */
const newest = (...oldestFirst: LadderNote[]) => [...oldestFirst].reverse();

describe("the hint ladder", () => {
    it.each([
        [[], 1],
        [[n("hint", 1)], 2],
        [[n("hint", 1), n("hint", 2)], 3],
        [[n("hint", 1), n("hint", 2), n("hint", 3)], null],
        // A fourth row would only be a chat that kept going past the ladder.
        [[n("hint", 1), n("hint", 2), n("hint", 3), n("hint", 3)], null],
        // The full answer starts the ladder over.
        [[n("hint", 1), n("hint", 2), n("hint", 3), n()], 1],
        [[n("hint", 1), n(), n("hint", 1)], 2],
        // A counterpart turn is not a rung.
        [[n("hint", 1), n("counterpart", 1)], 1],
    ] as const)("%j → next rung %s", (oldestFirst, expected) => {
        expect(nextHintLevel(newest(...oldestFirst))).toBe(expected);
    });
});

describe("the counterpart round", () => {
    it("counts the run of counterpart turns at the end of the chat", () => {
        expect(counterpartState([])).toMatchObject({ turns: 0, nextStep: 1, canClose: false, attempts: [] });
        const two = counterpartState(newest(n("counterpart", 1, "a"), n("counterpart", 2, "b")));
        expect(two).toMatchObject({ turns: 2, nextStep: 3, canClose: true, attempts: ["a", "b"] });
        const full = counterpartState(newest(n("counterpart", 1), n("counterpart", 2), n("counterpart", 3)));
        expect(full).toMatchObject({ turns: 3, nextStep: null, canClose: true });
    });
    it("a close, an ordinary turn or a hint ends the round", () => {
        for (const ender of [n("counterpart_close", 1), n(), n("hint", 1)])
            expect(counterpartState(newest(n("counterpart", 1), ender))).toMatchObject({ turns: 0, nextStep: 1, canClose: false });
    });
    it("shares one reading with the ladder", () => {
        expect(ladderOf(newest(n("hint", 1)))).toMatchObject({ hint: 2, counterpart: { turns: 0 } });
    });
});

describe("loadLadderNotes", () => {
    const rows = [
        { trainee_user_id: "u", chat_id: "c", mode: "hint", step: 1, attempt: "a", created_at: "2026-01-01T00:00:01Z" },
        { trainee_user_id: "u", chat_id: "c", mode: "hint", step: 2, attempt: "b", created_at: "2026-01-01T00:00:02Z" },
        { trainee_user_id: "v", chat_id: "c", mode: "hint", step: 1, attempt: "z", created_at: "2026-01-01T00:00:03Z" },
        { trainee_user_id: "u", word_chat_id: "w", mode: null, step: null, attempt: "w", created_at: "2026-01-01T00:00:04Z" },
    ];
    it("reads the person's own notes of the chat, newest first, and only the window it needs", async () => {
        const { db } = memoryDb({ training_turn_notes: rows.map((r) => ({ ...r })) });
        const loaded = await loadLadderNotes(db, { userId: "u", chat: { surface: "chat", chatId: "c" } });
        expect(loaded).toMatchObject({ ok: true });
        expect(loaded.ok && loaded.notes.map((note) => note.attempt)).toEqual(["b", "a"]);
    });
    it("has nothing for a new chat, and finds a chat on whichever surface it is", async () => {
        const { db } = memoryDb({ training_turn_notes: rows.map((r) => ({ ...r })) });
        expect(await loadLadderNotes(db, { userId: "u", chat: null })).toEqual({ ok: true, notes: [] });
        const anywhere = await loadLadderNotesAnywhere(db, { userId: "u", chatId: "w" });
        expect(anywhere.ok && anywhere.notes).toHaveLength(1);
        const other = await loadLadderNotesAnywhere(db, { userId: "nobody", chatId: "c" });
        expect(other).toEqual({ ok: true, notes: [] });
    });
    it("reports a read that failed", async () => {
        const { db, failNext } = memoryDb({ training_turn_notes: [] });
        failNext("training_turn_notes", "select", { message: "down" });
        expect((await loadLadderNotes(db, { userId: "u", chat: { surface: "chat", chatId: "c" } })).ok).toBe(false);
    });
});

describe("unverifiedLegalFooter: what the server marks, not the model", () => {
    const CC = "Código Civil.pdf";
    const verified = (quote: string, filename: string = CC) => [{ quote, verified: true, filename }];
    it.each([
        ["no legal reference at all", "Piensa en la figura y en los plazos.", [], false],
        ["an article from memory", "Revisa el artículo 1949 del Código Civil.", [], true],
        ["an article an unverified citation names", "Revisa el artículo 1949 del Código Civil.", [{ quote: "artículo 1949", verified: false, filename: CC }], true],
        ["an article a verified citation of the same law holds", "Revisa el artículo 1949 del Código Civil.", verified("Artículo 1949.- La facultad"), false],
        ["the same article, the law named in the answer's own words and the citation's text", "Revisa el artículo 1949 del Código Civil.", verified("Artículo 1949 del Código Civil"), false],
        ["an article of the verified quotes list, law from the document title", "Revisa el artículo 1949 del Código Civil.", [{ document: { title: CC, quotes: [{ quote: "Artículo 1949", verification: { verified: true, source_excerpt: "Artículo 1949" } }] } }], false],
        ["two articles, one backed", "Mira los artículos 1949 y 2000 del Código Civil.", verified("Artículo 1949.- La facultad"), true],
        ["a fraction the citation lacks", "Revisa el artículo 27, fracción II, de la Constitución.", verified("Artículo 27 de la Constitución"), true],
        ["a thesis from memory", "Consulta la tesis 1a./J. 12/2020.", [], true],
        ["a thesis a verified citation holds", "Consulta la tesis 1a./J. 12/2020.", verified("Tesis 1a./J. 12/2020 (10a.)"), false],
        ["garbage citations", "Revisa el artículo 5 del Código Civil.", "no es una lista", true],
    ] as const)("%s", (_name, answer, citations, flagged) => {
        expect(unverifiedLegalFooter(answer, citations)).toBe(flagged ? UNVERIFIED_LEGAL_FOOTER : null);
    });

    it("uses the footer it is given, and never throws", () => {
        expect(unverifiedLegalFooter("el artículo 9 del Código Civil", [], "otro pie")).toBe("otro pie");
        const cyclic: Record<string, unknown> = { verified: true };
        cyclic.quotes = [cyclic];
        expect(() => unverifiedLegalFooter("el artículo 9", [cyclic])).not.toThrow();
    });
});
