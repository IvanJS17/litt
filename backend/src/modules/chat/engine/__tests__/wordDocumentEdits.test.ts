import { describe, expect, it } from "vitest";
import { expectLinearCost } from "../../../../__tests__/helpers/linearCost";
import { BoundedTextError, charsForTokens, MODEL_TEXT_MAX_CHARS } from "../../../../lib/modelJsonFence";
import { persistWordDocumentEdits, projectWordDocumentEditEvents } from "../wordDocumentEdits";

describe("projectWordDocumentEditEvents", () => {
  it("keeps prose and edit references in exact source order", () => {
    const result = projectWordDocumentEditEvents([
      {
        type: "content",
        text: [
          "Opening prose.",
          "<EDITS>",
          JSON.stringify([
            {
              type: "edit_data",
              kind: "edit",
              deleted_text: "ten days",
              inserted_text: "five days",
              reason: "Shortens the cure period",
            },
            {
              type: "edit_data",
              kind: "edit",
              deleted_text: "written notice",
              formats: ["bold"],
              reason: "Highlights the requirement",
            },
          ]),
          "</EDITS>",
          "Closing prose.",
        ].join("\n"),
      },
    ]);

    expect(result.edits).toEqual([
      expect.objectContaining({
        blockIndex: 0,
        originalText: "ten days",
        replacementText: "five days",
      }),
      expect.objectContaining({
        blockIndex: 1,
        originalText: "written notice",
        formats: ["bold"],
      }),
    ]);
    expect(
      result.parts.map((part) =>
        part.kind === "content" ? part.text : `edit:${part.blockIndex}`,
      ),
    ).toEqual(["Opening prose.", "edit:0", "edit:1", "Closing prose."]);
  });

  it("leaves incomplete protocol in content instead of inventing an edit", () => {
    const source = 'Before\n<EDITS>\n[{"type":"edit_data"';
    const result = projectWordDocumentEditEvents([
      { type: "content", text: source },
    ]);

    expect(result.edits).toEqual([]);
    expect(result.parts).toEqual([
      expect.objectContaining({
        kind: "content",
        sourceEvent: { type: "content", text: source },
      }),
    ]);
  });

  it("preserves significant whitespace in JSON edit text", () => {
    const result = projectWordDocumentEditEvents([
      {
        type: "content",
        text: `<EDITS>${JSON.stringify([
          {
            type: "edit_data",
            kind: "edit",
            deleted_text: " target ",
            inserted_text: " replacement ",
            reason: "Preserves spacing",
          },
        ])}</EDITS>`,
      },
    ]);

    expect(result.edits[0]).toMatchObject({
      originalText: " target ",
      replacementText: " replacement ",
    });
  });
});

describe("projectWordDocumentEditEvents with tool-proposed edits", () => {
  it("places a word_edit_block exactly where the tool call landed", () => {
    const result = projectWordDocumentEditEvents([
      { type: "content", text: "Looking at the payment clause." },
      {
        type: "word_edit_block",
        block_index: 1_000,
        original_text: "ten days",
        replacement_text: "five days",
        formats: [],
        occurrence: null,
        reason: "Shortens the cure period",
      },
      {
        type: "word_edit_block",
        block_index: 1_001,
        original_text: "written notice",
        replacement_text: "",
        formats: ["bold"],
        occurrence: null,
        reason: "Highlights the requirement",
      },
      { type: "content", text: "Both changes are ready for review." },
    ]);

    expect(result.edits).toEqual([
      expect.objectContaining({
        blockIndex: 1_000,
        originalText: "ten days",
        replacementText: "five days",
        formats: [],
        occurrence: null,
      }),
      expect.objectContaining({
        blockIndex: 1_001,
        originalText: "written notice",
        formats: ["bold"],
      }),
    ]);
    // Same part shape as the <EDITS> channel: the normalized history a chat
    // replays cannot tell which channel produced a card.
    expect(
      result.parts.map((part) =>
        part.kind === "content" ? part.text : `edit:${part.blockIndex}`,
      ),
    ).toEqual([
      "Looking at the payment clause.",
      "edit:1000",
      "edit:1001",
      "Both changes are ready for review.",
    ]);
  });

  it("carries an explicit replace-all through", () => {
    const result = projectWordDocumentEditEvents([
      {
        type: "word_edit_block",
        block_index: 1_000,
        original_text: "Seller",
        replacement_text: "Vendor",
        formats: [],
        occurrence: "all",
        reason: "Rename the party",
      },
    ]);
    expect(result.edits[0]?.occurrence).toBe("all");
  });

  it("drops a duplicate ordinal rather than upserting two edits onto one row", () => {
    const block = {
      type: "word_edit_block",
      block_index: 1_000,
      replacement_text: "x",
      formats: [],
      occurrence: null,
      reason: null,
    };
    const result = projectWordDocumentEditEvents([
      { ...block, original_text: "first" },
      { ...block, original_text: "second" },
    ]);
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]?.originalText).toBe("first");
  });

  it("ignores a marker the canonical row could not hold", () => {
    const result = projectWordDocumentEditEvents([
      {
        type: "word_edit_block",
        block_index: 1_000,
        original_text: "x".repeat(201),
        replacement_text: "y",
        formats: [],
        occurrence: null,
        reason: null,
      },
      {
        type: "word_edit_block",
        block_index: -1,
        original_text: "valid",
        replacement_text: "y",
        formats: [],
        occurrence: null,
        reason: null,
      },
    ]);
    expect(result.edits).toEqual([]);
    expect(result.parts).toEqual([]);
  });
});

describe("projectWordDocumentEditEvents on a long answer", () => {
    const project = (text: string) => projectWordDocumentEditEvents([{ type: "content", text }]);

    it("finds no edits in an unclosed block in linear time", () => {
        // Cubic cost: the sizes stay small enough to measure before the bound.
        expectLinearCost((n) => project("<EDITS>" + " ".repeat(n) + "x"), { small: 48, large: 1_536 });
        expectLinearCost((n) => project("<EDITS>".repeat(n)), { small: 500, large: 16_000 });
        expect(project("<EDITS>".repeat(16_000)).edits).toEqual([]);
    });
    it("reads many closed blocks in linear time", () => {
        expectLinearCost((n) => project("a <edits> [] </EDITS> ".repeat(n)), { small: 500, large: 8_000 });
    });
    it("keeps the prose around a closed block and reads the rows inside", () => {
        const row = { type: "edit_data", kind: "edit", deleted_text: "plazo", inserted_text: "término", reason: "Precisión" };
        const got = project(`Antes.\n\n<edits>\n  ${JSON.stringify([row])}\n</EDITS> Después.`);
        expect(got.edits).toHaveLength(1);
        expect(got.parts.filter((part) => part.kind === "content").map((part) => part.text)).toEqual(["Antes.", "Después."]);
    });
    it("refuses an answer over the shared bound instead of showing its edits as text", () => {
        const over = "<EDITS>[]</EDITS>" + "x".repeat(MODEL_TEXT_MAX_CHARS);
        expect(() => project(over)).toThrow(BoundedTextError);
    });
    it("reads an answer of the largest size a model can write", () => {
        const row = { type: "edit_data", kind: "edit", deleted_text: "a", inserted_text: "b", reason: "r" };
        const largest = "x".repeat(charsForTokens(128_000) - 200) + `<EDITS>${JSON.stringify([row])}</EDITS>`;
        expect(project(largest).edits).toHaveLength(1);
    });
    it("fails the persisting of an answer over the shared bound, as any failed save does", async () => {
        const events = [{ type: "content", text: "<EDITS>[]</EDITS>" + "x".repeat(MODEL_TEXT_MAX_CHARS) }];
        const db = { from: () => { throw new Error("nothing is written"); } } as unknown as Parameters<typeof persistWordDocumentEdits>[0]["db"];
        await expect(persistWordDocumentEdits({ db, messageId: "m1", events, applyMode: "approval" })).rejects.toBeInstanceOf(BoundedTextError);
    });
});
