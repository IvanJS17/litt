// A rate-limit window longer than the limiter can hold is cut to the longest
// one it can: the limiter keeps limiting. Through the real app (the general
// limiter) and the window helpers; the settings are set before the app loads.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/log", () => ({ devLog: vi.fn(), isDev: false }));

type AppModule = typeof import("../../app.js");
let mod: AppModule;
beforeAll(async () => {
  vi.stubEnv("RATE_LIMIT_GENERAL_MAX", "3");
  vi.stubEnv("RATE_LIMIT_GENERAL_WINDOW_MINUTES", "36000");
  mod = await import("../../app.js");
});
afterAll(() => vi.unstubAllEnvs());

describe("rate-limit window ceiling", () => {
  it("refuses the fourth request with a maximum of 3 and a window of 36,000 minutes", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await request(mod.app).get("/health").set("X-Forwarded-For", "203.0.113.9")).status);
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
  });

  it("turns settings into milliseconds unchanged below the ceiling and cuts them at it", () => {
    const { minutes, hours, MAX_LIMITER_WINDOW_MS: ceiling } = mod;
    expect(ceiling).toBe(2_147_483_647);
    expect(minutes(15)).toBe(900_000);
    expect(hours(1)).toBe(3_600_000);
    expect(minutes(35_791)).toBe(35_791 * 60_000);
    expect(minutes(35_792)).toBe(ceiling);
    expect(minutes(36_000)).toBe(ceiling);
    expect(minutes(Number.MAX_SAFE_INTEGER)).toBe(ceiling);
    expect(hours(596)).toBe(596 * 3_600_000);
    expect(hours(597)).toBe(ceiling);
    expect(hours(1_000_000)).toBe(ceiling);
  });
});
