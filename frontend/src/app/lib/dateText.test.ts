import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  NO_DATE,
  formatNumericDateTime,
  formatShortDate,
  formatShortDateTime,
} from "./dateText";

const format = createFormatter({ locale: "es-MX", timeZone: "America/Mexico_City" });

describe("dateText", () => {
  it("formats a valid timestamp in Mexico City time", () => {
    expect(formatShortDate(format, "2026-11-12T20:00:00Z")).toContain("2026");
    expect(formatShortDateTime(format, new Date("2026-11-12T20:00:00Z"))).toContain("2026");
    expect(formatNumericDateTime(format, "2026-11-12T20:00:00Z")).not.toBe(NO_DATE);
  });

  it.each(["", "not a date", "2026-13-45"])("does not throw on %j", (bad) => {
    expect(formatShortDate(format, bad)).toBe(NO_DATE);
    expect(formatShortDateTime(format, bad)).toBe(NO_DATE);
    expect(formatNumericDateTime(format, bad)).toBe(NO_DATE);
  });
});
