// Password sign-in limiter, through the real app and the real auth router
// against a stand-in GoTrue. Clients are told apart the way production tells
// them apart: the single trusted proxy hop puts the client address in
// X-Forwarded-For.
import http from "node:http";
import type { AddressInfo } from "node:net";
import type express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/log", () => ({ devLog: vi.fn(), isDev: false }));

const ORIGIN = "http://app.test";
const CORRECT = "correct-password-1";

function jwt(): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "u1", exp, aud: "authenticated", role: "authenticated", session_id: "s1" })}.signature`;
}
const user = {
  id: "u1", aud: "authenticated", role: "authenticated", email: "owner@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};

let tokenCalls = 0;
const gotrue = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/auth/v1/token")) {
      tokenCalls++;
      const { password } = JSON.parse(body) as { password: string };
      if (password === CORRECT) {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        res.end(JSON.stringify({ access_token: jwt(), refresh_token: "r", expires_in: 3600, expires_at: exp, token_type: "bearer", user }));
        return;
      }
      if (password === "unconfirmed-password") {
        res.statusCode = 400;
        res.end(JSON.stringify({ code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" }));
        return;
      }
      if (password === "blocked-account-password") {
        res.statusCode = 400;
        res.end(JSON.stringify({ code: 400, error_code: "user_banned", msg: "User is banned" }));
        return;
      }
      if (password === "outage-password") {
        res.statusCode = 503;
        res.end(JSON.stringify({ msg: "upstream connect error" }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }));
      return;
    }
    res.end("[]");
  });
});

let app: express.Express;
beforeAll(async () => {
  await new Promise<void>((resolve) => gotrue.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("SUPABASE_URL", `http://127.0.0.1:${(gotrue.address() as AddressInfo).port}`);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret-test-key");
  vi.stubEnv("FRONTEND_URL", ORIGIN);
  vi.stubEnv("NODE_ENV", "development");
  // The per-address lane is not under test here; keep it out of the way.
  vi.stubEnv("RATE_LIMIT_AUTH_LOGIN_MAX", "10000");
  vi.stubEnv("RATE_LIMIT_AUTH_ACCOUNT_MAX", "10");
  vi.stubEnv("RATE_LIMIT_AUTH_ACCOUNT_GLOBAL_MAX", "15");
  app = (await import("../../app.js")).app;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => gotrue.close(() => resolve()));
});
beforeEach(() => {
  tokenCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const login = (email: string, password: string, client: string, origin: string | null = ORIGIN) => {
  const req = request(app).post("/auth/login").set("X-Forwarded-For", client);
  if (origin) req.set("Origin", origin);
  return req.send({ email, password });
};

describe("password sign-in account lanes", () => {
  it("keeps one client's failures from spending another client's budget for the same email", async () => {
    const email = "per-client@example.test";
    for (let i = 0; i < 10; i++) {
      expect((await login(email, "wrong-password-1", "198.51.100.1")).status).toBe(400);
    }

    const owner = await login(email, CORRECT, "198.51.100.2");
    expect(owner.status).toBe(200);

    const eleventh = await login(email, "wrong-password-1", "198.51.100.1");
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe("rate_limited");
  });

  it("does not count requests refused before any credential was checked", async () => {
    const email = "pre-credential@example.test";
    const client = "198.51.100.3";
    for (let i = 0; i < 10; i++) {
      expect((await login(email, "wrong-password-1", client, null)).status).toBe(403);
      expect((await login(email, "", client)).status).toBe(400);
    }
    expect(tokenCalls).toBe(0);

    // The counting starts from zero: ten refusals are still answered by the
    // provider, the eleventh is the first one limited.
    for (let i = 0; i < 10; i++) {
      expect((await login(email, "wrong-password-1", client)).status).toBe(400);
    }
    expect((await login(email, "wrong-password-1", client)).status).toBe(429);
  });

  it("limits one email across clients with a much larger lane that does not lock out a fresh client early", async () => {
    const email = "distributed@example.test";
    // 5 clients x 3 refusals = 15 = the lowered global ceiling of this test.
    for (let client = 10; client < 15; client++) {
      for (let i = 0; i < 3; i++) {
        expect((await login(email, "wrong-password-1", `198.51.100.${client}`)).status).toBe(400);
      }
    }

    const fresh = await login(email, CORRECT, "198.51.100.99");
    expect(fresh.status).toBe(429);
    expect(fresh.body.code).toBe("rate_limited");

    const other = await login("someone-else@example.test", CORRECT, "198.51.100.99");
    expect(other.status).toBe(200);
  });

  it("does not count successful sign-ins, a confirmed-password outcome or a provider outage", async () => {
    const email = "uncounted@example.test";
    const client = "198.51.100.4";
    for (let i = 0; i < 12; i++) {
      expect((await login(email, CORRECT, client)).status).toBe(200);
    }
    for (let i = 0; i < 12; i++) {
      // Correct password, but the address is not confirmed yet.
      expect((await login(email, "unconfirmed-password", client)).status).toBe(400);
    }
    for (let i = 0; i < 12; i++) {
      expect((await login(email, "outage-password", client)).status).toBe(503);
    }

    for (let i = 0; i < 10; i++) {
      expect((await login(email, "wrong-password-1", client)).status).toBe(400);
    }
    expect((await login(email, "wrong-password-1", client)).status).toBe(429);
  });
});

describe("password sign-in of a blocked account", () => {
  it("is answered exactly as refused credentials are", async () => {
    const wrong = await login("answer@example.test", "wrong-password-1", "198.51.100.40");
    const blocked = await login("answer@example.test", "blocked-account-password", "198.51.100.40");
    expect(blocked.status).toBe(wrong.status);
    expect(blocked.text).toBe(wrong.text);
    expect(blocked.body.code).toBe("invalid_credentials");
  });

  it("is counted by the sign-in limiter like refused credentials", async () => {
    const email = "counted@example.test";
    const client = "198.51.100.41";
    for (let i = 0; i < 10; i++) {
      expect((await login(email, "blocked-account-password", client)).status).toBe(400);
    }
    expect((await login(email, "wrong-password-1", client)).status).toBe(429);
  });
});
