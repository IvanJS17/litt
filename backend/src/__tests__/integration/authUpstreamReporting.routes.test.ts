// Upstream MIK-125: one GoTrue outage used to file three reports per auth
// route (authError's reportError, the response sanitizer's own line, and a
// copy of it). This drives the real auth router behind the real sanitizer,
// with a real Supabase client pointed at a closed port, and counts the local
// sanitized `[report]` lines (lib/observability/report.ts) and the
// sanitizer's `[http/sanitized-internal-error]` line where they are written.
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "../../middleware/auth";
import { protectInternalErrorResponses } from "../../middleware/internalErrorResponse";
import { authRouter } from "../../modules/auth/auth.routes";
import { resetUpstreamOutagesForTests } from "../../lib/upstreamOutage";
import { withDiagnosticScope } from "../../lib/observability/report";

const origin = "https://app.example.test";
const saved: Record<string, string | undefined> = {};
const ENV = {
  FRONTEND_URL: origin,
  // Port 9 (discard) is closed on CI runners and dev machines: auth-js gets
  // ECONNREFUSED and turns it into an AuthRetryableFetchError (status 0).
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  SUPABASE_SECRET_KEY: "test-secret-key",
};

type ReportLine = Record<string, unknown>;
let errorLines: unknown[][] = [];

/** The sanitized report lines reportError wrote. */
function reports(): ReportLine[] {
  return errorLines
    .filter(([label]) => label === "[report]")
    .map(([, line]) => JSON.parse(String(line)) as ReportLine);
}

/** Lines the response sanitizer wrote for a 5xx it had to rewrite. */
function sanitized(): unknown[][] {
  return errorLines.filter(([label]) => label === "[http/sanitized-internal-error]");
}

// A GoTrue that is up and failing on something of ours, the way a broken
// auth.users trigger or a missing migration makes it answer sign-up.
const brokenGoTrue = http.createServer((_req, res) => {
  res.writeHead(500, { "content-type": "application/json" });
  res.end(JSON.stringify({ code: 500, msg: "Database error saving new user" }));
});

// A GoTrue (and PostgREST) that is back: it knows the bearer token's user,
// and every table read finds nothing.
const healthySupabase = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url?.startsWith("/auth/v1/user")) {
    res.end(JSON.stringify({ id: "u1", aud: "authenticated", email: "lawyer@example.test" }));
  } else {
    res.end("[]");
  }
});

beforeAll(async () => {
  await new Promise<void>((resolve) => brokenGoTrue.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => healthySupabase.listen(0, "127.0.0.1", resolve));
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(async () => {
  await new Promise<void>((resolve) => brokenGoTrue.close(() => resolve()));
  await new Promise<void>((resolve) => healthySupabase.close(() => resolve()));
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  errorLines = [];
  resetUpstreamOutagesForTests();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args);
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function app() {
  const server = express();
  // Each request gets its own diagnostic scope, as requestDiagnostics does in
  // app.ts, so the operation a handler names reaches its report line.
  server.use((_req, _res, next) => withDiagnosticScope(() => next()));
  server.use((_req, res, next) => {
    res.locals.requestId = "req-auth-outage";
    next();
  });
  server.use(protectInternalErrorResponses);
  server.use(express.json());
  server.use("/auth", authRouter);
  // The real app rate-limits every auth-guarded route (app.ts); CodeQL's
  // js/missing-rate-limiting query expects the same in front of this one.
  const limiter = rateLimit({ windowMs: 60_000, limit: 1_000 });
  server.get("/projects", limiter, requireAuth, (_req, res) => {
    res.json({ ok: true });
  });
  return server;
}

it("answers an unreachable GoTrue with 503 upstream_unavailable and writes exactly one report", async () => {
  const res = await request(app())
    .post("/auth/login")
    .set("Origin", origin)
    .send({ email: "lawyer@example.test", password: "correct horse battery" });

  expect(res.status).toBe(503);
  expect(res.body).toEqual({
    code: "upstream_unavailable",
    detail: "The server is temporarily unreachable. Please try again shortly.",
    request_id: "req-auth-outage",
  });

  expect({ reports: reports().length, sanitized: sanitized().length })
    .toEqual({ reports: 1, sanitized: 0 });
  expect(reports()[0]).toMatchObject({
    operation: "auth.signin",
    error_kind: "auth.supabase_unavailable",
    http_status: 503,
  });
});

it("keeps a GoTrue 500 a reported 500, not an outage the user should wait out", async () => {
  const { port } = brokenGoTrue.address() as AddressInfo;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  try {
    const res = await request(app())
      .post("/auth/login")
      .set("Origin", origin)
      .send({ email: "lawyer@example.test", password: "correct horse battery" });

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "internal_error", request_id: "req-auth-outage" });
    const reported = reports();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      error_kind: "auth.supabase_unavailable",
      http_status: 500,
    });
    expect(sanitized()).toHaveLength(0);
  } finally {
    process.env.SUPABASE_URL = ENV.SUPABASE_URL;
  }
});

describe("requireAuth with GoTrue unreachable", () => {
  function jwt(exp: number): string {
    const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "u1", exp, aud: "authenticated", role: "authenticated" })}.signature`;
  }
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: "u1", aud: "authenticated", email: "lawyer@example.test" };
  const session = { access_token: jwt(exp), refresh_token: "r1", expires_in: 3600, expires_at: exp, token_type: "bearer", user };
  const cookie = `mike-session=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;

  it.each([
    ["a cookie session", (req: request.Test) => req.set("Cookie", cookie)],
    ["a bearer token", (req: request.Test) => req.set("Authorization", `Bearer ${jwt(exp)}`)],
  ])("answers %s 503 upstream_unavailable, not a 401 that signs the user out", async (_label, authenticate) => {
    const res = await authenticate(request(app()).get("/projects"));

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: "upstream_unavailable",
      detail: "The server is temporarily unreachable. Please try again shortly.",
      request_id: "req-auth-outage",
    });
    // The session is kept: no cleared cookie on the way back.
    expect(String(res.headers["set-cookie"] ?? "")).not.toContain("Max-Age=0");
    const reported = reports();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      error_kind: "auth.supabase_unavailable",
      http_status: 503,
    });
    expect(sanitized()).toHaveLength(0);
  });

  it("writes one report per outage, not one per request, and reports the next outage after a quiet period", async () => {
    const warn = vi.mocked(console.warn);
    let clock = 1_000_000;
    resetUpstreamOutagesForTests(() => clock);
    const outageEvents = () =>
      reports().filter((line) => line.error_kind === "auth.supabase_unavailable");
    const bearer = (req: request.Test) => req.set("Authorization", `Bearer ${jwt(exp)}`);

    for (let i = 0; i < 3; i++) {
      const res = await bearer(request(app()).get("/projects"));
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("upstream_unavailable");
    }
    // A minute on: the quiet repeats are due their counted log line.
    clock += 60_000;
    const session = await bearer(request(app()).get("/auth/session"));
    expect(session.status).toBe(503);
    expect(session.body.code).toBe("upstream_unavailable");

    expect(outageEvents()).toHaveLength(1);
    expect(outageEvents()[0]).toMatchObject({
      operation: "auth.session",
      http_status: 503,
    });
    // The quiet repeats are counted in the log instead.
    expect(
      warn.mock.calls.some(([line]) => String(line).startsWith("[upstream-unavailable] still failing (gotrue:0)")),
    ).toBe(true);
    expect(sanitized()).toHaveLength(0);

    // GoTrue comes back and a request authenticates.
    const { port } = healthySupabase.address() as AddressInfo;
    process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
    try {
      const ok = await bearer(request(app()).get("/projects"));
      expect(ok.status).not.toBe(503);
    } finally {
      process.env.SUPABASE_URL = ENV.SUPABASE_URL;
    }

    // The next outage, more than the 15-minute window after the last report,
    // is news again (one returning sooner is the same outage flapping).
    clock += 15 * 60_000;
    const again = await bearer(request(app()).get("/projects"));
    expect(again.status).toBe(503);
      expect(outageEvents()).toHaveLength(2);
  });
});
