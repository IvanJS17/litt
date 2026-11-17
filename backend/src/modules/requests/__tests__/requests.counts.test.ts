import { describe, expect, it } from "vitest";
import { periodBounds, todayInFirmZone } from "../requests.counts";

describe("periodBounds", () => {
  it("takes the month of a date", () => {
    expect(periodBounds("month", "2026-11-16")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(periodBounds("month", "2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(periodBounds("month", "2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("takes the quarter of a date", () => {
    expect(periodBounds("quarter", "2026-01-01")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(periodBounds("quarter", "2026-05-31")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(periodBounds("quarter", "2026-11-16")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("refuses what is not a real calendar date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "26-11-16", "", "2026-11-16T00:00:00Z"])
      expect(periodBounds("month", bad)).toBeNull();
  });
});

describe("todayInFirmZone", () => {
  it("reads the date in Mexico City, not in UTC", () => {
    expect(todayInFirmZone(new Date("2026-11-17T03:30:00Z"))).toBe("2026-11-16");
    expect(todayInFirmZone(new Date("2026-11-16T18:00:00Z"))).toBe("2026-11-16");
  });
});
