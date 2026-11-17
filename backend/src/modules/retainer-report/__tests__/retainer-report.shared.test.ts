import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  inRange,
  parseLocale,
  parseNote,
  parsePeriod,
  periodFor,
  todayInMexicoCity,
} from "../retainer-report.shared";

describe("report period", () => {
  it("is the last N calendar days ending today, both ends included", () => {
    expect(periodFor("2026-11-17", 90)).toEqual({
      days: 90,
      start: "2026-08-20",
      end: "2026-11-17",
      horizonStart: "2026-11-17",
      horizonEnd: "2027-02-15",
    });
    const p = periodFor("2026-11-17", 30);
    expect(daysBetween(p.start, p.end) + 1).toBe(30);
    expect(p.start).toBe("2026-10-19");
  });

  it("crosses a year change and a leap day", () => {
    expect(periodFor("2027-01-10", 30).start).toBe("2026-12-12");
    expect(periodFor("2028-03-10", 60).start).toBe("2028-01-11");
    expect(periodFor("2028-01-10", 60).horizonEnd).toBe("2028-03-10");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("follows the day in Mexico City, not UTC", () => {
    expect(todayInMexicoCity(new Date("2026-11-18T05:59:00Z"))).toBe("2026-11-17");
    expect(todayInMexicoCity(new Date("2026-11-18T06:00:00Z"))).toBe("2026-11-18");
  });

  it("includes both ends of a range", () => {
    expect(inRange("2026-08-20", "2026-08-20", "2026-11-17")).toBe(true);
    expect(inRange("2026-11-17", "2026-08-20", "2026-11-17")).toBe(true);
    expect(inRange("2026-08-19", "2026-08-20", "2026-11-17")).toBe(false);
    expect(inRange("2026-11-18", "2026-08-20", "2026-11-17")).toBe(false);
  });
});

describe("parsers", () => {
  it.each([["30d", 30], ["60d", 60], ["90d", 90]])("reads %s", (value, days) => expect(parsePeriod(value)).toBe(days));
  it.each([["90"], ["45d"], ["090d"], ["sent"], [90], [undefined], [null]])("refuses %j", (value) =>
    expect(parsePeriod(value)).toBeNull(),
  );
  it("reads the locale, defaulting to Spanish", () => {
    expect(parseLocale(undefined)).toBe("es-MX");
    expect(parseLocale("en-US")).toBe("en-US");
    expect(parseLocale("fr-FR")).toBeNull();
    expect(parseLocale(["es-MX"])).toBeNull();
  });
  it("reads an optional note", () => {
    expect(parseNote(undefined)).toEqual({ ok: true, note: null });
    expect(parseNote(null)).toEqual({ ok: true, note: null });
    expect(parseNote("  \n ")).toEqual({ ok: true, note: null });
    expect(parseNote(" enviado por correo ")).toEqual({ ok: true, note: "enviado por correo" });
    expect(parseNote("a".repeat(500))).toMatchObject({ ok: true });
    expect(parseNote("a".repeat(501))).toEqual({ ok: false });
    expect(parseNote(5)).toEqual({ ok: false });
  });
});
