import { describe, expect, it } from "vitest";
import { createAnonymousMailCap, mailOverallCap } from "./anonymousMailCap";

describe("anonymous mail cap", () => {
  it("keeps no more addresses than the instance count lets through, and forgets them with their window", () => {
    let at = 0;
    const cap = createAnonymousMailCap({ overall: 5, now: () => at });
    for (let i = 0; i < 1000; i++) cap.admit(`person-${i}@example.test`);
    expect(cap.size()).toBe(5);
    at += 60 * 60 * 1000;
    cap.admit("later@example.test");
    expect(cap.size()).toBe(1);
  });

  it("answers a check like an admission and counts nothing", () => {
    const cap = createAnonymousMailCap({ overall: 2, now: () => 0 });
    for (let i = 0; i < 10; i++) expect(cap.check("a@example.test")).toEqual({ kind: "send" });
    expect(cap.size()).toBe(0);
    expect(cap.admit("a@example.test")).toEqual({ kind: "send" });
    expect(cap.admit("b@example.test")).toEqual({ kind: "send" });
    expect(cap.check("c@example.test").kind).toBe("overall_full");
    expect(cap.admit("c@example.test").kind).toBe("overall_full");
  });

  it("lets the count at the send decide when many checks passed before it", () => {
    const cap = createAnonymousMailCap({ overall: 15, now: () => 0 });
    const asked = Array.from({ length: 100 }, (_, i) => cap.check(`p-${i}@example.test`).kind);
    expect(asked.every((kind) => kind === "send")).toBe(true);
    let sent = 0;
    for (let i = 0; i < 100; i++) if (cap.admit(`p-${i}@example.test`).kind === "send") sent++;
    expect(sent).toBe(15);
  });

  it("does not keep an address in clear", () => {
    const cap = createAnonymousMailCap({ overall: 5 });
    cap.admit("clear@example.test");
    expect(JSON.stringify(cap.keys())).not.toContain("clear");
  });

  it("reads the setting as a plain whole number from 1 to 1000", () => {
    expect(mailOverallCap(undefined)).toBe(15);
    expect(mailOverallCap("1000")).toBe(1000);
    expect(mailOverallCap(" 7")).toBe(15);
  });

  describe("over any span of an hour", () => {
    const HOUR = 60 * 60 * 1000;

    /** The most mails let through within any span of one hour. */
    function busiestHour(times: number[]): number {
      let most = 0;
      for (const start of times) {
        most = Math.max(most, times.filter((t) => t >= start && t < start + HOUR).length);
      }
      return most;
    }

    it("lets through at most the instance count in any hour, also around the end of the first one", () => {
      let at = 0;
      const cap = createAnonymousMailCap({ overall: 15, now: () => at });
      const sent: number[] = [];
      const ask = (name: string) => {
        if (cap.admit(`${name}@example.test`).kind === "send") sent.push(at);
      };
      ask("first");
      at = HOUR - 1000;
      for (let i = 0; i < 14; i++) ask(`before-${i}`);
      at = HOUR + 1;
      for (let i = 0; i < 15; i++) ask(`after-${i}`);
      expect(sent).toHaveLength(16);
      expect(busiestHour(sent)).toBeLessThanOrEqual(15);
    });

    it("lets through at most 3 mails to one address in any hour", () => {
      let at = 0;
      const cap = createAnonymousMailCap({ overall: 15, now: () => at });
      const sent: number[] = [];
      const ask = () => {
        if (cap.admit("one@example.test").kind === "send") sent.push(at);
      };
      ask();
      at = HOUR - 1000;
      ask();
      ask();
      at = HOUR + 1;
      for (let i = 0; i < 5; i++) ask();
      expect(sent).toHaveLength(4);
      expect(busiestHour(sent)).toBeLessThanOrEqual(3);
    });

    it("tells when the oldest counted mail leaves the span", () => {
      let at = 1000;
      const cap = createAnonymousMailCap({ overall: 2, now: () => at });
      cap.admit("a@example.test");
      at = 11_000;
      cap.admit("b@example.test");
      at = 21_000;
      expect(cap.admit("c@example.test")).toEqual({
        kind: "overall_full",
        limit: 2,
        retryAfterSeconds: (HOUR + 1000 - 21_000) / 1000,
      });
    });

    it("stays bounded for 100,000 distinct addresses", () => {
      let at = 0;
      const cap = createAnonymousMailCap({ overall: 1000, now: () => at });
      let sent = 0;
      for (let i = 0; i < 100_000; i++) {
        if (cap.admit(`person-${i}@example.test`).kind === "send") sent++;
      }
      expect(sent).toBe(1000);
      expect(cap.size()).toBe(1000);
    });
  });
});
