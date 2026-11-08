import { describe, expect, it } from "vitest";
import {
  AUTHORSHIP_MIN_WORDS,
  countWords,
  estimateAuthorship,
  normalizeSentence,
  roundShares,
  splitSentences,
  type AuthorshipEdit,
  type AuthorshipInput,
} from "./documentAuthorship";

const accepted = (inserted_text: string): AuthorshipEdit => ({ status: "accepted", inserted_text });
const pending = (inserted_text: string): AuthorshipEdit => ({ status: "pending", inserted_text });
const rejected = (inserted_text: string): AuthorshipEdit => ({ status: "rejected", inserted_text });

const AI_ONE = "La cláusula quinta establece la obligación de pago mensual.";
const AI_TWO = "El deudor responderá con todos sus bienes presentes y futuros.";
const MINE = "Agrego que el plazo de gracia es de quince días naturales.";

function estimate(overrides: Partial<AuthorshipInput> & Pick<AuthorshipInput, "text">) {
  return estimateAuthorship({
    edits: [],
    baseline: { kind: "file", text: "" },
    ...overrides,
  });
}

describe("splitSentences", () => {
  it.each([
    ["one sentence per line", "Primera línea aquí.\nSegunda línea aquí.", 2],
    ["sentences on one line", "Esto es uno. Esto es dos! ¿Esto es tres?", 3],
    ["blank lines and CRLF", "Uno dos tres.\r\n\r\nCuatro cinco seis.", 2],
    ["extraction markers", "[Page 1]\n## Page 2\n[Page 2 form fields]\n[Slide 3]\nTexto real aquí.", 1],
    ["a line of only punctuation", "---\n...\nTexto real aquí.", 1],
    ["an abbreviation before a number or lower case", "El art. 5 y la fracc. ii aplican.", 1],
    ["the empty text", "", 0],
  ])("%s", (_name, text, count) => {
    expect(splitSentences(text)).toHaveLength(count);
  });

  it("keeps the text of a sentence as written", () => {
    expect(splitSentences("  Art. 5 aplica.  ")[0]).toBe("Art. 5 aplica.");
  });
});

describe("normalizeSentence and countWords", () => {
  it("lower-cases and collapses white space only", () => {
    expect(normalizeSentence("  El   DEUDOR\tpaga. ")).toBe("el deudor paga.");
    expect(normalizeSentence("El deudor paga")).not.toBe(normalizeSentence("El deudor paga."));
  });

  it("counts tokens with a letter or digit", () => {
    expect(countWords("Pagará 1,200 pesos - hoy.")).toBe(4);
    expect(countWords("— . …")).toBe(0);
  });
});

describe("roundShares", () => {
  it.each([
    [[1, 1, 1], [35, 35, 30]],
    [[10, 0, 0], [100, 0, 0]],
    [[0, 0, 0], [0, 0, 0]],
    [[50, 50, 0], [50, 50, 0]],
    [[90, 5, 5], [90, 5, 5]],
    [[1, 99, 0], [5, 95, 0]],
    [[1, 1, 98], [5, 5, 90]],
  ])("%j -> %j", (parts, expected) => {
    const rounded = roundShares(parts);
    expect(rounded).toEqual(expected);
    for (const share of rounded) expect(share % 5).toBe(0);
  });

  it("adds up to 100 and never shows a non-empty part as 0", () => {
    for (let a = 0; a < 400; a += 7)
      for (let b = 0; b < 400; b += 53)
        for (let c = 0; c < 400; c += 61) {
          if (a + b + c === 0) continue;
          const rounded = roundShares([a, b, c]);
          expect(rounded.reduce((x, y) => x + y, 0)).toBe(100);
          [a, b, c].forEach((part, i) => {
            if (part > 0) expect(rounded[i]).toBeGreaterThanOrEqual(5);
          });
        }
  });
});

describe("estimateAuthorship", () => {
  it("attributes an accepted assistant sentence to the AI and the rest to the person", () => {
    const result = estimate({
      text: `${AI_ONE}\n${MINE}`,
      edits: [accepted(AI_ONE)],
      baseline: { kind: "file", text: "" },
    });
    expect(result.words).toEqual({
      total: countWords(AI_ONE) + countWords(MINE),
      ai: countWords(AI_ONE),
      person: countWords(MINE),
      undetermined: 0,
    });
    expect(result.shares).toEqual({ person: 55, ai: 45, undetermined: 0 });
    expect(result.edits).toEqual({ accepted: 1, rejected: 0, pending: 0 });
  });

  it("matches without regard to case or white space, and not otherwise", () => {
    const loud = AI_ONE.toUpperCase().replace(/ /g, "  ");
    expect(estimate({ text: loud, edits: [accepted(AI_ONE)] }).words?.ai).toBeGreaterThan(0);
    const reworded = AI_ONE.replace("quinta", "sexta");
    const result = estimate({ text: reworded, edits: [accepted(AI_ONE)] });
    expect(result.words?.ai).toBe(0);
    expect(result.words?.person).toBe(countWords(reworded));
  });

  it("counts a sentence a person rewrote as theirs", () => {
    const result = estimate({
      text: "La cláusula quinta establece la obligación de pago quincenal.",
      edits: [accepted(AI_ONE)],
    });
    expect(result.shares).toEqual({ person: 100, ai: 0, undetermined: 0 });
  });

  it("does not attribute text of a rejected edit that is not in the version", () => {
    const result = estimate({ text: MINE, edits: [rejected(AI_ONE), accepted(AI_TWO)] });
    expect(result.words?.ai).toBe(0);
    expect(result.edits).toEqual({ accepted: 1, rejected: 1, pending: 0 });
  });

  it("leaves text of a pending edit undetermined, not the person's", () => {
    const result = estimate({ text: `${AI_ONE}\n${MINE}`, edits: [pending(AI_ONE)] });
    expect(result.words).toMatchObject({ undetermined: countWords(AI_ONE), person: countWords(MINE), ai: 0 });
    expect(result.edits.pending).toBe(1);
  });

  it("an accepted edit wins over a pending one with the same sentence", () => {
    const result = estimate({ text: AI_ONE, edits: [pending(AI_ONE), accepted(AI_ONE)] });
    expect(result.words).toMatchObject({ ai: countWords(AI_ONE), undetermined: 0 });
  });

  it("splits a multi-sentence insertion into sentences", () => {
    const result = estimate({
      text: `${AI_TWO} ${MINE}`,
      edits: [accepted(`${AI_ONE} ${AI_TWO}`)],
    });
    expect(result.words).toMatchObject({ ai: countWords(AI_TWO), person: countWords(MINE) });
  });

  describe("sentences shorter than the minimum", () => {
    const short = "Así es.";
    it("are undetermined when equal to assistant text, never the AI's", () => {
      expect(countWords(short)).toBeLessThan(AUTHORSHIP_MIN_WORDS);
      const result = estimate({ text: `${short}\n${MINE}`, edits: [accepted(short)] });
      expect(result.words).toMatchObject({ ai: 0, undetermined: 2, person: countWords(MINE) });
    });

    it("are the person's when nothing the assistant produced equals them", () => {
      expect(estimate({ text: short, edits: [accepted(AI_ONE)] }).words?.person).toBe(2);
    });
  });

  describe("starting text", () => {
    it("generated by the assistant: unchanged sentences are the AI's", () => {
      const result = estimate({
        text: `${AI_ONE}\n${AI_TWO}\n${MINE}`,
        baseline: { kind: "ai", text: `${AI_ONE}\n${AI_TWO}` },
      });
      expect(result.baseline).toBe("ai");
      expect(result.words).toMatchObject({ ai: countWords(AI_ONE) + countWords(AI_TWO), person: countWords(MINE) });
    });

    it("a version that is the generated text itself is entirely the AI's (short lines aside)", () => {
      const result = estimate({ text: `${AI_ONE}\n${AI_TWO}`, baseline: { kind: "ai", text: `${AI_ONE}\n${AI_TWO}` } });
      expect(result.shares).toEqual({ person: 0, ai: 100, undetermined: 0 });
    });

    it("an uploaded file: its sentences are undetermined, never the person's", () => {
      const result = estimate({
        text: `${AI_ONE}\n${MINE}`,
        baseline: { kind: "file", text: AI_ONE },
      });
      expect(result.baseline).toBe("file");
      expect(result.words).toMatchObject({ undetermined: countWords(AI_ONE), person: countWords(MINE), ai: 0 });
    });

    it("an uploaded file that is the version itself is entirely undetermined", () => {
      const result = estimate({ text: `${AI_ONE}\n${MINE}`, baseline: { kind: "file", text: `${AI_ONE}\n${MINE}` } });
      expect(result.shares).toEqual({ person: 0, ai: 0, undetermined: 100 });
    });

    it("an assistant edit accepted into an uploaded file is the AI's even if the file has it", () => {
      const result = estimate({ text: AI_ONE, edits: [accepted(AI_ONE)], baseline: { kind: "file", text: AI_ONE } });
      expect(result.shares).toEqual({ person: 0, ai: 100, undetermined: 0 });
    });

    it("unknown: all but accepted assistant text is undetermined", () => {
      const result = estimate({
        text: `${AI_ONE}\n${MINE}`,
        edits: [accepted(AI_ONE)],
        baseline: { kind: "unknown" },
      });
      expect(result.baseline).toBe("unknown");
      expect(result.words).toMatchObject({ ai: countWords(AI_ONE), undetermined: countWords(MINE), person: 0 });
    });
  });

  it("answers no shares for text without words", () => {
    const result = estimate({ text: "[Page 1]\n\n" });
    expect(result.words?.total).toBe(0);
    expect(result.shares).toBeNull();
  });

  it("carries the pages it could not read", () => {
    expect(estimate({ text: MINE, textlessPages: 3 }).textless_pages).toBe(3);
    expect(estimate({ text: MINE }).textless_pages).toBe(0);
  });

  it("rounds to multiples of 5 and keeps a small AI share visible", () => {
    const person = Array.from({ length: 19 }, (_, i) => `Aporte propio número ${i + 1} del texto.`).join("\n");
    const result = estimate({ text: `${person}\n${AI_ONE}`, edits: [accepted(AI_ONE)] });
    const { shares } = result;
    expect(shares).not.toBeNull();
    expect(shares!.person + shares!.ai + shares!.undetermined).toBe(100);
    expect([shares!.person, shares!.ai, shares!.undetermined].every((value) => value % 5 === 0)).toBe(true);
    expect(shares!.ai).toBeGreaterThan(0);
  });
});
