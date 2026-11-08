import { describe, expect, it } from "vitest";
import { fakeTranslate, noteText, attemptText, confidenceText } from "./trainingTestText";
import { trainingUrgencyPassText } from "./trainingText";

describe("trainingText", () => {
  it("builds the words of each component from the host's translator", () => {
    expect(attemptText.label).toBe("Your approach (2–3 lines)");
    expect(attemptText.tooShort({ length: 5, min: 60, missing: 55 })).toBe(
      "5/60 caracteres: faltan 55.",
    );
    expect(attemptText.tooLong({ length: 4002, max: 4000, excess: 2 })).toBe(
      "4002/4000 caracteres: sobran 2.",
    );
    expect(confidenceText.levels).toEqual({
      1: "Almost a guess",
      2: "I doubt it",
      3: "Fairly sure",
      4: "Sure",
    });
    expect(noteText.confidence("Sure")).toBe("Your mark: Sure");
    expect(noteText.foundation("weak")).toBe("Basis: weak");
    expect(noteText.verdicts.no_coincide).toBe("Doesn't match");
    expect(noteText.confidenceLevels[1]).toBe("Almost a guess");
  });

  it("says only the time when an urgency pass ends today, and the date as well otherwise", () => {
    const now = new Date(2026, 10, 7, 9, 0);
    const today = new Date(2026, 10, 7, 17, 30);
    const later = new Date(2026, 10, 9, 8, 5);
    expect(trainingUrgencyPassText(fakeTranslate, today.toISOString(), now)).toBe(
      `today until ${today.toISOString()}`,
    );
    expect(trainingUrgencyPassText(fakeTranslate, later.toISOString(), now)).toBe(
      `later until ${later.toISOString()}`,
    );
    expect(trainingUrgencyPassText(fakeTranslate, "not a date", now)).toBe("");
    expect(trainingUrgencyPassText(fakeTranslate, today.toISOString())).toMatch(/until/);
  });
});
