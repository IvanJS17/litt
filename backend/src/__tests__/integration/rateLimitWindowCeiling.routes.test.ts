// A rate-limit window longer than the limiter can hold is cut to the longest
// one it can: the limiter keeps limiting. Through the real app (the general
// limiter) and the window helpers; the settings are set before the app loads.
import { MAX_LIMITER_WINDOW_MS as ceiling, hours, minutes } from "../../lib/limiterWindow";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Row } from "../helpers/memoryDb";

const h = vi.hoisted(() => ({ state: null as null | { db: unknown; tables: Record<string, Row[]> } }));

vi.mock("../../lib/log", () => ({ devLog: vi.fn(), isDev: false }));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => h.state!.db) }));
vi.mock("../../middleware/auth", async () => {
  const { authMock } = await import("../helpers/authMock.js");
  return authMock();
});

type AppModule = typeof import("../../app.js");
let mod: AppModule;
beforeAll(async () => {
  vi.stubEnv("RATE_LIMIT_GENERAL_MAX", "3");
  vi.stubEnv("RATE_LIMIT_GENERAL_WINDOW_MINUTES", "36000");
  for (const name of [
    "RATE_LIMIT_PROFILE_EXTRACT_MAX",
    "RATE_LIMIT_RULE_SUGGEST_MAX",
    "RATE_LIMIT_RULE_READ_MAX",
    "RATE_LIMIT_UPLOAD_SESSION_MUTATION_MAX",
    "RATE_LIMIT_UPLOAD_SESSION_POLL_MAX",
  ])
    vi.stubEnv(name, "2");
  for (const name of [
    "RATE_LIMIT_PROFILE_EXTRACT_WINDOW_MINUTES",
    "RATE_LIMIT_RULE_SUGGEST_WINDOW_MINUTES",
    "RATE_LIMIT_UPLOAD_SESSION_MUTATION_WINDOW_MINUTES",
    "RATE_LIMIT_UPLOAD_SESSION_POLL_WINDOW_MINUTES",
  ])
    vi.stubEnv(name, "36000");
  mod = await import("../../app.js");
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  h.state = memoryDb({});
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("rate-limit window ceiling", () => {
  it("refuses the fourth request with a maximum of 3 and a window of 36,000 minutes", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await request(mod.app).get("/health").set("X-Forwarded-For", "203.0.113.9")).status);
    expect(statuses.slice(0, 3)).not.toContain(429);
    expect(statuses[3]).toBe(429);
  });

  it("turns settings into milliseconds unchanged below the ceiling and cuts them at it", () => {
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

describe("each limiter whose window setting goes through the helpers, over its real route, with a 36,000-minute window", () => {
  // The general limiter counts per address and is set to 3 above: each case uses its own address.
  let caller = 0;
  const limits = async (method: "get" | "post", path: string, code: string) => {
    const statuses: number[] = [];
    let last: { code?: string } = {};
    const address = `198.51.100.${++caller}`;
    for (let i = 0; i < 3; i++) {
      const call = method === "get" ? request(mod.app).get(path) : request(mod.app).post(path).send({});
      const res = await call.set("X-Forwarded-For", address);
      statuses.push(res.status);
      last = res.body;
    }
    expect(statuses.slice(0, 2)).not.toContain(429);
    expect(statuses[2]).toBe(429);
    expect(last.code).toBe(code);
  };
  const matter = `/projects/${id(120)}/matters/${id(130)}`;

  it("limits the extraction of a client profile", async () => {
    await limits("post", `${matter}/profile/versions/${id(210)}/extract`, "rate_limited");
  });
  it("limits a radar suggestion", async () => {
    await limits("post", `${matter}/radar/rules/suggestions/versions/${id(210)}/suggest`, "rate_limited");
  });
  it("limits a radar read of all documents", async () => {
    await limits("post", `${matter}/radar/rules/suggestions/read`, "rate_limited");
  });
  it("limits a radar rule proposal", async () => {
    await limits("post", `/projects/${id(120)}/rule-proposals/versions/${id(210)}/propose`, "rate_limited");
  });
  it("limits opening and changing upload sessions", async () => {
    await limits("post", "/upload-sessions", "upload_session_control_rate_limit");
  });
  it("limits polling an upload session", async () => {
    await limits("get", `/upload-sessions/${id(900)}`, "upload_session_poll_rate_limit");
  });
});
