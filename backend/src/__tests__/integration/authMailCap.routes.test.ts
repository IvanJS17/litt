// Anonymous requests that make the auth service send a mail are capped per
// target address and for the instance as a whole, so they leave room in the
// auth service's single hourly mail budget for invitations and confirmations.
// Through the real app against a stand-in auth service. Clients are told apart
// the way production tells them apart: the single trusted proxy hop puts the
// client address in X-Forwarded-For.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/log", () => ({ devLog: vi.fn(), isDev: false }));

const ORIGIN = "http://app.test";
const HOUR = 60 * 60 * 1000;

const calls = { recover: 0, signup: 0, invite: 0 };
const gotrue = http.createServer((req, res) => {
  req.on("data", () => undefined);
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/auth/v1/recover")) {
      calls.recover++;
      res.end("{}");
      return;
    }
    if (req.url?.startsWith("/auth/v1/signup")) {
      calls.signup++;
      res.end(JSON.stringify({ id: "u-new", aud: "authenticated", email: "x@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }));
      return;
    }
    if (req.url?.startsWith("/auth/v1/invite")) {
      calls.invite++;
      res.end(JSON.stringify({ id: "u-invited", aud: "authenticated", email: "invited@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
      return;
    }
    res.end("[]");
  });
});

async function loadApp(env: Record<string, string> = {}): Promise<express.Express> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import("../../app.js")).app;
}

let app: express.Express;
beforeAll(async () => {
  await new Promise<void>((resolve) => gotrue.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("SUPABASE_URL", `http://127.0.0.1:${(gotrue.address() as AddressInfo).port}`);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret-test-key");
  vi.stubEnv("FRONTEND_URL", ORIGIN);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => gotrue.close(() => resolve()));
});
beforeEach(async () => {
  calls.recover = calls.signup = calls.invite = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  app = await loadApp({ PLATFORM_ADMIN_EMAILS: "", AUTH_ANONYMOUS_MAIL_HOURLY_CAP: "" });
});
afterEach(() => {
  vi.useRealTimers();
});

let nextClient = 0;
const freshClient = () => `198.51.${100 + Math.floor(nextClient / 250)}.${(nextClient++ % 250) + 1}`;

const reset = (email: unknown, client = freshClient()) =>
  request(app).post("/auth/password-reset").set("X-Forwarded-For", client).set("Origin", ORIGIN).send({ email });

const signup = (email: string, client = freshClient()) =>
  request(app)
    .post("/auth/signup")
    .set("X-Forwarded-For", client)
    .set("Origin", ORIGIN)
    .send({ email, password: "a-long-enough-password-1" });

describe("password-reset requests are capped per target address", () => {
  it("answers the fourth request for one address within the hour with the same 204 and does not reach the auth service", async () => {
    const email = "one-address@example.test";
    for (let i = 0; i < 3; i++) expect((await reset(email)).status).toBe(204);
    expect(calls.recover).toBe(3);

    const fourth = await reset(email);
    expect(fourth.status).toBe(204);
    expect(fourth.text).toBe("");
    expect(calls.recover).toBe(3);

    // Another address is not affected.
    expect((await reset("another-address@example.test")).status).toBe(204);
    expect(calls.recover).toBe(4);
  });

  it("treats case and surrounding whitespace as the same address, and nothing else", async () => {
    for (const variant of ["Mixed.Case@Example.test", "  mixed.case@example.test", "MIXED.CASE@EXAMPLE.TEST  "]) {
      expect((await reset(variant)).status).toBe(204);
    }
    expect(calls.recover).toBe(3);
    expect((await reset(" mixed.case@example.test ")).status).toBe(204);
    expect(calls.recover).toBe(3);

    // A different local part (a plus tag) is a different address.
    expect((await reset("mixed.case+tag@example.test")).status).toBe(204);
    expect(calls.recover).toBe(4);
  });

  it("lets requests through again when the hour has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const email = "window@example.test";
    for (let i = 0; i < 4; i++) await reset(email);
    expect(calls.recover).toBe(3);

    vi.setSystemTime(Date.now() + HOUR - 1000);
    await reset(email);
    expect(calls.recover).toBe(3);

    vi.setSystemTime(Date.now() + 2000);
    await reset(email);
    expect(calls.recover).toBe(4);
  });
});

describe("password-reset requests are capped for the instance", () => {
  it("answers the sixteenth distinct address with 429 and does not reach the auth service", async () => {
    for (let i = 0; i < 3; i++) await reset("already-mailed@example.test");
    for (let i = 1; i <= 12; i++) expect((await reset(`distinct-${i}@example.test`)).status).toBe(204);
    expect(calls.recover).toBe(15);

    const sixteenth = await reset("distinct-16@example.test");
    expect(sixteenth.status).toBe(429);
    expect(sixteenth.body.code).toBe("rate_limited");
    expect(typeof sixteenth.body.detail).toBe("string");
    expect(Number(sixteenth.headers["retry-after"])).toBeGreaterThan(0);
    expect(sixteenth.headers["ratelimit-limit"]).toBe("15");
    expect(sixteenth.headers["ratelimit-remaining"]).toBe("0");
    expect(calls.recover).toBe(15);

    // An address that already has its mails stays indistinguishable.
    expect((await reset("already-mailed@example.test")).status).toBe(204);
    expect(calls.recover).toBe(15);
  });

  it("starts a new count when the hour has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 1; i <= 16; i++) await reset(`hour-${i}@example.test`);
    expect(calls.recover).toBe(15);

    vi.setSystemTime(Date.now() + HOUR + 1000);
    expect((await reset("hour-after@example.test")).status).toBe(204);
    expect(calls.recover).toBe(16);
  });

  it("counts neither a request that fails validation nor one the per-client lane refused", async () => {
    for (const bad of ["not-an-address", "", 42, null]) {
      expect((await reset(bad)).status).toBe(204);
    }
    expect(calls.recover).toBe(0);

    // One client: ten requests pass its lane, the rest are refused by it.
    const client = "203.0.113.7";
    for (let i = 0; i < 14; i++) await reset(`one-client-${i}@example.test`, client);
    expect(calls.recover).toBe(10);

    // The refused ones spent nothing: five more from other clients still fit.
    for (let i = 0; i < 5; i++) expect((await reset(`other-client-${i}@example.test`)).status).toBe(204);
    expect(calls.recover).toBe(15);
    expect((await reset("one-too-many@example.test")).status).toBe(429);
    expect(calls.recover).toBe(15);
  });

  it("does not spend the instance count on a request over the per-address cap", async () => {
    for (let i = 0; i < 10; i++) await reset("repeat@example.test");
    expect(calls.recover).toBe(3);
    for (let i = 1; i <= 12; i++) expect((await reset(`room-${i}@example.test`)).status).toBe(204);
    expect(calls.recover).toBe(15);
  });

  it("keeps the same two caps for sign-up mails, which spend the same budget", async () => {
    const email = "signup-cap@example.test";
    for (let i = 0; i < 4; i++) await signup(email);
    expect(calls.signup).toBe(3);

    for (let i = 1; i <= 12; i++) await reset(`shared-${i}@example.test`);
    expect(calls.signup + calls.recover).toBe(15);
    expect((await signup("shared-over@example.test")).status).toBe(429);
  });
});

describe("the instance cap setting", () => {
  it.each([
    ["5", 5],
    ["1", 1],
    ["1000", 1000],
    ["0", 15],
    ["1001", 15],
    ["-3", 15],
    ["2.5", 15],
    ["1e2", 15],
    ["abc", 15],
    ["", 15],
  ])("reads %j as %i", async (value, expected) => {
    app = await loadApp({ AUTH_ANONYMOUS_MAIL_HOURLY_CAP: value });
    const probe = await reset("probe@example.test");
    expect(probe.status).toBe(204);
    // Spend the cap with distinct addresses, then look at what the next one gets.
    for (let i = 2; i <= Math.min(expected, 40); i++) await reset(`setting-${i}@example.test`);
    if (expected <= 40) {
      expect(calls.recover).toBe(expected);
      const over = await reset("setting-over@example.test");
      expect(over.status).toBe(429);
      expect(over.headers["ratelimit-limit"]).toBe(String(expected));
    }
  });
});

describe("other auth mails", () => {
  it("still send an invitation while the reset cap is exhausted", async () => {
    for (let i = 1; i <= 16; i++) await reset(`exhaust-${i}@example.test`);
    expect(calls.recover).toBe(15);

    const { sendSignupInvite } = await import("../../lib/inviteEmail.js");
    const { createServerSupabase } = await import("../../lib/supabase.js");
    expect(await sendSignupInvite(createServerSupabase(), "invited@example.test")).toBe(true);
    expect(calls.invite).toBe(1);
  });
});

describe("the caps hold over any hour", () => {
  it("lets through at most the instance count in any hour, also around the end of the first one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await reset("edge-first@example.test");
    vi.setSystemTime(Date.now() + HOUR - 1000);
    for (let i = 0; i < 14; i++) await reset(`edge-before-${i}@example.test`);
    expect(calls.recover).toBe(15);

    vi.setSystemTime(Date.now() + 2000);
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await reset(`edge-after-${i}@example.test`)).status);
    // Only the first mail has left the hour, so only one more fits.
    expect(calls.recover).toBe(16);
    expect(statuses.filter((status) => status === 429)).toHaveLength(14);
  });

  it("lets through at most 3 mails to one address in any hour, also around the end of the first one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const email = "edge-address@example.test";
    await reset(email);
    vi.setSystemTime(Date.now() + HOUR - 1000);
    await reset(email);
    await reset(email);
    expect(calls.recover).toBe(3);

    vi.setSystemTime(Date.now() + 2000);
    for (let i = 0; i < 5; i++) await reset(email);
    expect(calls.recover).toBe(4);
  });

  it("gives the time until the oldest counted mail leaves as Retry-After", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await reset("retry-first@example.test");
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    for (let i = 0; i < 14; i++) await reset(`retry-${i}@example.test`);
    const refused = await reset("retry-over@example.test");
    expect(refused.status).toBe(429);
    expect(refused.headers["retry-after"]).toBe(String(50 * 60));
  });

  it("gives exactly the count to 100 requests at once", async () => {
    const answers = await Promise.all(
      Array.from({ length: 100 }, (_, i) => reset(`burst-${i}@example.test`)),
    );
    expect(answers.filter((answer) => answer.status === 204)).toHaveLength(15);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(85);
    expect(calls.recover).toBe(15);

    app = await loadApp();
    calls.recover = 0;
    await Promise.all(Array.from({ length: 100 }, () => reset("burst-one@example.test")));
    expect(calls.recover).toBe(3);
  });
});

describe("a request the route refuses spends nothing", () => {
  it("does not count 15 password-reset requests refused for their origin", async () => {
    for (let i = 0; i < 15; i++) {
      const refused = await request(app)
        .post("/auth/password-reset")
        .set("X-Forwarded-For", freshClient())
        .set("Origin", "http://other.test")
        .send({ email: `refused-${i}@example.test` });
      expect(refused.status).toBe(403);
    }
    expect(calls.recover).toBe(0);
    expect((await reset("legitimate@example.test")).status).toBe(204);
    expect(calls.recover).toBe(1);
  });

  it("does not count 15 sign-up requests refused for their origin", async () => {
    for (let i = 0; i < 15; i++) {
      const refused = await request(app)
        .post("/auth/signup")
        .set("X-Forwarded-For", freshClient())
        .set("Origin", "http://other.test")
        .send({ email: `refused-${i}@example.test`, password: "a-long-enough-password-1" });
      expect(refused.status).toBe(403);
    }
    expect(calls.signup).toBe(0);
    expect((await signup("legitimate@example.test")).status).toBe(201);
    expect(calls.signup).toBe(1);
  });

  it("does not count a sign-up whose body is refused", async () => {
    for (let i = 0; i < 15; i++) {
      const refused = await request(app)
        .post("/auth/signup")
        .set("X-Forwarded-For", freshClient())
        .set("Origin", ORIGIN)
        .send({ email: `short-${i}@example.test`, password: "x" });
      expect(refused.status).toBe(400);
    }
    expect((await signup("legitimate@example.test")).status).toBe(201);
    expect(calls.signup).toBe(1);
  });
});

describe("a capped answer looks like the route's own answer", () => {
  const names = (headers: Record<string, unknown>) =>
    Object.keys(headers)
      .filter((name) => !["date", "etag", "set-cookie"].includes(name))
      .sort();

  it("password reset: same status, body and header names for an address at its cap", async () => {
    const email = "same-answer@example.test";
    const ordinary = await reset(email);
    await reset(email);
    await reset(email);
    const capped = await reset(email);
    expect(calls.recover).toBe(3);
    expect(capped.status).toBe(ordinary.status);
    expect(capped.text).toBe(ordinary.text);
    expect(capped.headers["cache-control"]).toBe(ordinary.headers["cache-control"]);
    expect(names(capped.headers)).toEqual(names(ordinary.headers));
  });

  it("sign-up in closed beta: same status, body and headers for an address at its cap", async () => {
    app = await loadApp({ PLATFORM_ADMIN_EMAILS: "boss@example.test" });
    const email = "beta-same@example.test";
    const ordinary = await signup(email);
    for (let i = 0; i < 2; i++) await signup(email);
    const capped = await signup(email);
    expect(capped.status).toBe(ordinary.status);
    expect(capped.body).toEqual(ordinary.body);
    expect(capped.headers["cache-control"]).toBe(ordinary.headers["cache-control"]);
    expect(names(capped.headers)).toEqual(names(ordinary.headers));
  });

  it("sign-up in closed beta: an admitted address at its cap gets no invitation", async () => {
    app = await loadApp({ PLATFORM_ADMIN_EMAILS: "boss@example.test" });
    for (let i = 0; i < 3; i++) await reset("boss@example.test");
    const capped = await signup("boss@example.test");
    expect(capped.status).toBe(201);
    expect(calls.invite).toBe(0);
  });

  it("sign-up when open: same status, cache header and body shape", async () => {
    const email = "open-same@example.test";
    const ordinary = await signup(email);
    for (let i = 0; i < 2; i++) await signup(email);
    const capped = await signup(email);
    expect(calls.signup).toBe(3);
    expect(capped.status).toBe(ordinary.status);
    expect(capped.headers["cache-control"]).toBe(ordinary.headers["cache-control"]);
    expect(Object.keys(capped.body).sort()).toEqual(Object.keys(ordinary.body).sort());
  });

  it("the instance answer carries the route's cache header", async () => {
    for (let i = 0; i < 15; i++) await reset(`full-${i}@example.test`);
    const refused = await reset("full-over@example.test");
    expect(refused.status).toBe(429);
    expect(refused.headers["cache-control"]).toBe("private, no-store");
  });
});
