import { describe, expect, it } from "vitest";
import { addDays, bucketOf, daysBetween, isIsoDate, NEXT_WINDOW_DAYS, RADAR_TIME_ZONE, todayInMexicoCity } from "../radar.dates";

describe("calendar-day arithmetic", () => {
  it("moves by exact days", () => {
    expect(addDays("2026-11-16", 0)).toBe("2026-11-16");
    expect(addDays("2026-11-16", 90)).toBe("2027-02-14");
    expect(addDays("2026-11-16", -90)).toBe("2026-08-18");
  });

  it("crosses the end of a month, with 28, 30 and 31 day months", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    // Days, never months: 31 January plus 30 days is 2 March, not "28 February".
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("knows 29 February", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    // 1900 and 2100 are not leap years; 2000 is.
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2000-02-28", 1)).toBe("2000-02-29");
    expect(addDays("2027-02-28", 366)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 365)).toBe("2029-02-28");
  });

  it("changes the year both ways", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2027-01-10", -30)).toBe("2026-12-11");
  });

  it("answers null for anything that is not a date or leaves the supported years", () => {
    expect(addDays("2026-02-30", 1)).toBeNull();
    expect(addDays("ayer", 1)).toBeNull();
    expect(addDays("2026-01-01", 1.5)).toBeNull();
    expect(addDays("2026-01-01", Number.NaN)).toBeNull();
    expect(addDays("9999-12-31", 1)).toBeNull();
    expect(addDays("1000-01-01", -1)).toBeNull();
    expect(addDays("1000-01-01", 1)).toBe("1000-01-02");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-11-16", "2026-11-16")).toBe(0);
    expect(daysBetween("2026-11-16", "2026-11-17")).toBe(1);
    expect(daysBetween("2026-11-16", "2026-11-15")).toBe(-1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    // A daylight-saving change in the host zone must not move a calendar day.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-1-1")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate(20260101)).toBe(false);
  });
});

describe("today in America/Mexico_City", () => {
  it("names the zone", () => {
    expect(RADAR_TIME_ZONE).toBe("America/Mexico_City");
  });

  it("uses the Mexico City day, not the UTC one (UTC-6, no daylight saving)", () => {
    // 05:59 UTC is 23:59 of the previous day in Mexico City.
    expect(todayInMexicoCity(new Date("2026-11-17T05:59:59Z"))).toBe("2026-11-16");
    expect(todayInMexicoCity(new Date("2026-11-17T06:00:00Z"))).toBe("2026-11-17");
    expect(todayInMexicoCity(new Date("2026-07-17T05:59:59Z"))).toBe("2026-07-16");
    expect(todayInMexicoCity(new Date("2026-07-17T06:00:00Z"))).toBe("2026-07-17");
  });

  it("handles the year change and 29 February", () => {
    expect(todayInMexicoCity(new Date("2027-01-01T05:00:00Z"))).toBe("2026-12-31");
    expect(todayInMexicoCity(new Date("2027-01-01T06:00:00Z"))).toBe("2027-01-01");
    expect(todayInMexicoCity(new Date("2028-03-01T05:30:00Z"))).toBe("2028-02-29");
  });
});

describe("buckets", () => {
  const today = "2026-11-16";
  it("puts the exact day in the next window, yesterday overdue", () => {
    expect(bucketOf("2026-11-15", today)).toBe("overdue");
    expect(bucketOf("2026-11-16", today)).toBe("next_30");
    expect(bucketOf("2026-11-17", today)).toBe("next_30");
  });

  it("closes the window at 30 days", () => {
    expect(NEXT_WINDOW_DAYS).toBe(30);
    expect(bucketOf("2026-12-16", today)).toBe("next_30");
    expect(bucketOf("2026-12-17", today)).toBe("later");
  });

  it("sends a day without a date to review", () => {
    expect(bucketOf(null, today)).toBe("review");
  });
});
