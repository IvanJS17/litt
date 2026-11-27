import { describe, expect, it } from "vitest";
import { createAnonymousMailCap, mailOverallCap } from "./anonymousMailCap";

describe("anonymous mail cap", () => {
  it("keeps no more addresses than the instance count lets through, and forgets them with their window", () => {
    let at = 0;
    const cap = createAnonymousMailCap({ overall: 5, now: () => at });
    for (let i = 0; i < 1000; i++) cap.admit("reset", `person-${i}@example.test`);
    expect(cap.size()).toBe(5);
    at += 60 * 60 * 1000;
    cap.admit("reset", "later@example.test");
    expect(cap.size()).toBe(1);
  });

  it("counts a request of each kind for an address apart from the other kind", () => {
    const cap = createAnonymousMailCap({ overall: 50, now: () => 0 });
    for (let i = 0; i < 3; i++) expect(cap.admit("reset", "a@example.test").kind).toBe("send");
    expect(cap.admit("reset", "a@example.test").kind).toBe("address_full");
    for (let i = 0; i < 3; i++) expect(cap.admit("signup", "a@Example.test ").kind).toBe("send");
    expect(cap.admit("signup", "a@example.test").kind).toBe("address_full");
  });

  it("shares one instance count between the two kinds", () => {
    const cap = createAnonymousMailCap({ overall: 4, now: () => 0 });
    expect(cap.admit("reset", "a@example.test").kind).toBe("send");
    expect(cap.admit("signup", "b@example.test").kind).toBe("send");
    expect(cap.admit("reset", "c@example.test").kind).toBe("send");
    expect(cap.admit("signup", "d@example.test").kind).toBe("send");
    expect(cap.admit("reset", "e@example.test").kind).toBe("overall_full");
    expect(cap.admit("signup", "f@example.test").kind).toBe("overall_full");
  });

  it("decides the instance cap first, then a repeat, then the address cap, then sends", () => {
    let at = 0;
    const cap = createAnonymousMailCap({ overall: 4, now: () => at });
    const span = { repeatWithinMs: 10 * 60 * 1000 };
    expect(cap.admit("signup", "full@example.test", span).kind).toBe("send");
    at = 11 * 60 * 1000;
    expect(cap.admit("signup", "full@example.test", span).kind).toBe("send");
    at = 22 * 60 * 1000;
    expect(cap.admit("signup", "full@example.test", span).kind).toBe("send");
    expect(cap.admit("signup", "full@example.test", span).kind).toBe("repeat");
    at += 11 * 60 * 1000;
    expect(cap.admit("signup", "full@example.test", span).kind).toBe("address_full");
    expect(cap.admit("signup", "other@example.test", span).kind).toBe("send");
    // The instance is at its cap: the same refusal for an address at its cap, a repeat and an unseen one.
    for (const address of ["full@example.test", "other@example.test", "unseen@example.test"]) {
      expect(cap.admit("signup", address, span).kind).toBe("overall_full");
    }
    expect(cap.admit("reset", "full@example.test").kind).toBe("overall_full");
  });

  it("lets the first of many requests at once decide", () => {
    const cap = createAnonymousMailCap({ overall: 15, now: () => 0 });
    let sent = 0;
    for (let i = 0; i < 100; i++) if (cap.admit("signup", `p-${i}@example.test`).kind === "send") sent++;
    expect(sent).toBe(15);
  });

  describe("a repeat within a span", () => {
    const SPAN = 10 * 60 * 1000;

    it("is neither counted nor refused as full, and ends when the last counted request is the span old", () => {
      let at = 0;
      const cap = createAnonymousMailCap({ overall: 2, now: () => at });
      expect(cap.admit("signup", "a@example.test", { repeatWithinMs: SPAN })).toEqual({ kind: "send" });
      for (let i = 0; i < 20; i++) {
        at += 1000;
        expect(cap.admit("signup", "a@example.test", { repeatWithinMs: SPAN })).toEqual({ kind: "repeat" });
      }
      at = SPAN - 1;
      expect(cap.admit("signup", "A@example.test ", { repeatWithinMs: SPAN })).toEqual({ kind: "repeat" });
      at = SPAN;
      expect(cap.admit("signup", "a@example.test", { repeatWithinMs: SPAN })).toEqual({ kind: "send" });
      // Two were counted: the instance is full, and a repeat is told apart from nothing else then.
      at += 1000;
      expect(cap.admit("signup", "b@example.test", { repeatWithinMs: SPAN }).kind).toBe("overall_full");
      expect(cap.admit("signup", "a@example.test", { repeatWithinMs: SPAN }).kind).toBe("overall_full");
    });

    it("looks only at the last counted request of the same kind", () => {
      const cap = createAnonymousMailCap({ overall: 5, now: () => 0 });
      expect(cap.admit("reset", "a@example.test").kind).toBe("send");
      expect(cap.admit("signup", "a@example.test", { repeatWithinMs: SPAN }).kind).toBe("send");
    });

    it("is not asked for without a span", () => {
      const cap = createAnonymousMailCap({ overall: 5, now: () => 0 });
      for (let i = 0; i < 3; i++) expect(cap.admit("signup", "a@example.test").kind).toBe("send");
    });
  });

  it("does not keep an address in clear", () => {
    const cap = createAnonymousMailCap({ overall: 5 });
    cap.admit("reset", "clear@example.test");
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
        if (cap.admit("reset", `${name}@example.test`).kind === "send") sent.push(at);
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
        if (cap.admit("reset", "one@example.test").kind === "send") sent.push(at);
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
      cap.admit("reset", "a@example.test");
      at = 11_000;
      cap.admit("reset", "b@example.test");
      at = 21_000;
      expect(cap.admit("reset", "c@example.test")).toEqual({
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
        if (cap.admit("reset", `person-${i}@example.test`).kind === "send") sent++;
      }
      expect(sent).toBe(1000);
      expect(cap.size()).toBe(1000);
    });
  });
});
