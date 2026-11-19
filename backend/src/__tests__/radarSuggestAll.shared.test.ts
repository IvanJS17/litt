import { describe, expect, it } from "vitest";
import {
  buildReadAllPrompt,
  buildReadAllSystemPrompt,
  groupIntoBatches,
  isBetterCitation,
  MAX_BATCH_CHARS,
  opaqueDocumentId,
  parseQuestion,
  planRead,
} from "../modules/radar/radar.suggest.all.shared";

// The pure parts of "Sugerir reglas" over all documents (S8c): grouping whole
// documents, the closed answer and the choice between two citations.
const doc = (versionId: string, chars: number) => ({ versionId, chars });

describe("groupIntoBatches", () => {
  it("never exceeds the cap, never splits or drops a document, and keeps the order", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let x = seed;
      const next = () => (x = (x * 1103515245 + 12345) % 2147483648);
      const docs = Array.from({ length: 1 + (next() % 12) }, (_, i) => doc(`v${i}`, 1 + (next() % 150000)));
      const { batches, tooLong } = groupIntoBatches(docs);
      for (const batch of batches) expect(batch.reduce((n, d) => n + d.chars, 0)).toBeLessThanOrEqual(MAX_BATCH_CHARS);
      expect(tooLong.every((d) => d.chars > MAX_BATCH_CHARS)).toBe(true);
      const placed = [...batches.flat(), ...tooLong].map((d) => d.versionId).sort();
      expect(placed).toEqual(docs.map((d) => d.versionId).sort());
      const order = batches.flat().map((d) => d.versionId);
      expect(order).toEqual(docs.filter((d) => d.chars <= MAX_BATCH_CHARS).map((d) => d.versionId));
    }
  });

  it("puts exactly 120,000 together, 120,001 apart, and nothing in no batch", () => {
    expect(groupIntoBatches([doc("a", 60000), doc("b", 60000)]).batches).toHaveLength(1);
    expect(groupIntoBatches([doc("a", 60000), doc("b", 60001)]).batches).toHaveLength(2);
    expect(groupIntoBatches([doc("a", 120001)])).toEqual({ batches: [], tooLong: [doc("a", 120001)] });
    expect(groupIntoBatches([])).toEqual({ batches: [], tooLong: [] });
  });
});

describe("planRead", () => {
  const sug = { kind: "suggestion", rule_code: "a.b", document_id: "doc_1", quote: "q", reason: "r", page: null };
  it("reads suggestions with their document id and questions with a rule code only", () => {
    const plan = planRead([sug, { kind: "question", rule_code: "c.d" }]);
    expect(plan).toMatchObject({ invalid: 0, suggestions: [{ ruleCode: "a.b", documentId: "doc_1" }], questions: [{ ruleCode: "c.d" }] });
  });
  it("counts as invalid whatever is outside the schema, and anything past the caps", () => {
    const plan = planRead([
      { ...sug, document_id: undefined },
      { ...sug, document_id: "" },
      { ...sug, due: "2026-01-01" },
      { kind: "question", rule_code: "c.d", question: "texto del modelo" },
      { kind: "question", rule_code: "  " },
      { kind: "other" },
      null,
      "x",
      [],
    ]);
    expect(plan).toMatchObject({ suggestions: [], questions: [], invalid: 9 });
    const many = planRead([...Array.from({ length: 30 }, () => sug), ...Array.from({ length: 10 }, () => ({ kind: "question", rule_code: "c.d" }))]);
    expect(many.suggestions).toHaveLength(20);
    expect(many.questions.length).toBeLessThanOrEqual(8);
    expect(many.invalid).toBe(many.suggestions.length + many.questions.length < 40 ? 40 - many.suggestions.length - many.questions.length : 0);
  });
  it("parses a question only from kind and rule_code", () => {
    expect(parseQuestion({ kind: "question", rule_code: " x.y " })).toEqual({ ruleCode: "x.y" });
    expect(parseQuestion({ kind: "question", rule_code: 3 })).toBeNull();
  });
});

describe("prompts and citations", () => {
  it("numbers documents with opaque ids and never names them", () => {
    expect(opaqueDocumentId(0)).toBe("doc_1");
    const user = buildReadAllPrompt(["uno", "dos"], "abc");
    expect(user).toContain("=== DOCUMENT doc_1 abc ===\nuno\n=== DOCUMENT doc_2 abc ===\ndos");
  });
  it("tells the model it only names the rule of a question, and lists the catalog it is given", () => {
    const prompt = buildReadAllSystemPrompt([{ code: "a.b", name: "Nombre", appliesWhen: "Cuando\n aplica" }]);
    expect(prompt).toContain("- a.b | Nombre | Cuando aplica");
    expect(prompt).toContain("you never write the question");
    expect(prompt).toContain("document_id");
  });
  it("prefers a page, then the longer passage, and keeps what is held on a tie", () => {
    expect(isBetterCitation({ page: 2, quote: "a" }, { page: null, quote: "abcdef" })).toBe(true);
    expect(isBetterCitation({ page: null, quote: "abcdef" }, { page: 2, quote: "a" })).toBe(false);
    expect(isBetterCitation({ page: null, quote: "abc" }, { page: null, quote: "ab" })).toBe(true);
    expect(isBetterCitation({ page: null, quote: "ab" }, { page: null, quote: "ab" })).toBe(false);
  });
});
