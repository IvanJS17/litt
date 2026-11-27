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
});
