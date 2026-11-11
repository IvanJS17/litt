import { describe, expect, it } from "vitest";
import { JSON_BODY_LIMIT_BYTES, exceedsJsonBodyLimit } from "./requestLimits";

describe("exceedsJsonBodyLimit", () => {
  it("accepts a small body", () => {
    expect(exceedsJsonBodyLimit('{"text":"hola"}')).toBe(false);
  });

  it("counts bytes, not characters", () => {
    const atLimit = "a".repeat(JSON_BODY_LIMIT_BYTES);
    expect(exceedsJsonBodyLimit(atLimit)).toBe(false);
    expect(exceedsJsonBodyLimit(`${atLimit}a`)).toBe(true);
    // Half as many characters, but two bytes each.
    expect(exceedsJsonBodyLimit("é".repeat(JSON_BODY_LIMIT_BYTES / 2))).toBe(false);
    expect(exceedsJsonBodyLimit("é".repeat(JSON_BODY_LIMIT_BYTES / 2 + 1))).toBe(true);
  });
});
