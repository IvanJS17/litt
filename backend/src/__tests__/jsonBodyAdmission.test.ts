// What the API reads before it knows who is calling: a small, uncompressed JSON
// body. Larger bodies are read only for an authenticated caller, and exactly
// one identity lookup serves such a request. Real app, real requireAuth,
// stand-in GoTrue.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import type express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LEGAL_VERSION } from "../modules/user/user.service";

vi.mock("../lib/log", () => ({ devLog: vi.fn(), isDev: false }));

const ORIGIN = "http://app.test";
const MB = 1024 * 1024;
const DOC_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-0000000000aa";

const user = {
  id: USER_ID, aud: "authenticated", role: "authenticated", email: "reader@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z",
};

let userLookups = 0;
const seen: { request?: http.IncomingMessage; bytesRead: number; body?: { text?: string } } = { bytesRead: 0 };
const SESSION_ID = "00000000-0000-4000-8000-0000000000bb";
const gotrue = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/auth/v1/user")) {
      userLookups++;
      res.end(JSON.stringify(user));
      return;
    }
    if (req.url?.startsWith("/auth/v1/token")) {
      res.statusCode = 400;
      res.end(JSON.stringify({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }));
      return;
    }
    if (req.url?.startsWith("/rest/v1/upload_sessions")) {
      const row = { id: SESSION_ID, user_id: USER_ID, status: "pending_upload" };
      res.end(JSON.stringify(String(req.headers.accept).includes("pgrst.object") ? row : [row]));
      return;
    }
    if (req.url?.startsWith("/rest/v1/user_profiles")) {
      const row = { terms_accepted_version: LEGAL_VERSION };
      res.end(JSON.stringify(String(req.headers.accept).includes("pgrst.object") ? row : [row]));
      return;
    }
    res.end("[]"); // PostgREST: no rows
  });
});

let app: express.Express;
let server: http.Server;
beforeAll(async () => {
  await new Promise<void>((resolve) => gotrue.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("SUPABASE_URL", `http://127.0.0.1:${(gotrue.address() as AddressInfo).port}`);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SUPABASE_SECRET_KEY", "secret-test-key");
  vi.stubEnv("FRONTEND_URL", ORIGIN);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RATE_LIMIT_UPLOAD_SESSION_IP_MAX", "5");
  app = (await import("../app.js")).app;
  server = http.createServer(app);
  // What the route saw, and how much of the request the server had read from
  // the socket when it answered.
  server.prependListener("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    seen.request = req;
    res.on("finish", () => {
      seen.bytesRead = req.socket.bytesRead;
      seen.body = (req as unknown as { body?: { text?: string } }).body;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => gotrue.close(() => resolve()));
});
beforeEach(() => {
  userLookups = 0;
  seen.bytesRead = 0;
  seen.body = undefined;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// Each test is its own client: the upload-session address lane is lowered to 5.
const post = (path: string, client: string) =>
  request(app).post(path).set("X-Forwarded-For", client).set("Content-Type", "application/json");

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

// What the Next gateway sends for a body: no content-length, chunked, written
// in pieces. Supertest always declares a length, so these go out raw.
function rawPost(path: string, client: string, headers: Record<string, string>, chunks: Buffer[]) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const address = server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: true });
    let answer: { status: number; body: string } | undefined;
    const req = http.request(
      // A keep-alive connection of its own per request, as the gateway holds
      // one: the server's byte count is this request's, and a refusal is read
      // before the connection is dropped.
      { host: "127.0.0.1", port: address.port, path, method: "POST", agent,
        headers: { "Content-Type": "application/json", "X-Forwarded-For": client, ...headers } },
      (res) => {
        answer = { status: res.statusCode ?? 0, body: "" };
        res.on("data", (chunk) => { answer!.body += chunk; });
        res.on("end", () => { agent.destroy(); resolve(answer!); });
        res.on("error", () => resolve(answer!));
      },
    );
    // A server that has already answered may drop the rest of an unwanted body.
    // The answer can still be on its way when the write side reports the break.
    req.on("error", (error) => {
      if (answer) return resolve(answer);
      setTimeout(() => (answer ? resolve(answer) : reject(error)), 250);
    });
    void (async () => {
      for (const chunk of chunks) {
        if (req.destroyed) return;
        if (!req.write(chunk)) await new Promise((r) => req.once("drain", r));
        await tick();
      }
      req.end();
    })();
  });
}

const split = (data: Buffer, size: number) =>
  Array.from({ length: Math.ceil(data.length / size) }, (_, i) => data.subarray(i * size, (i + 1) * size));
const withoutRequestId = (body: string) => {
  const { request_id: _ignored, ...rest } = JSON.parse(body || "{}");
  return rest;
};

const malformed = (bytes: number) => `{"pad":"${"a".repeat(bytes)}`;
const padded = (bytes: number) => JSON.stringify({ text: "a".repeat(bytes), base_version_id: USER_ID });

describe("body admission before authentication", () => {
  it("refuses an anonymous 2 MB body by authentication, without parsing it", async () => {
    const res = await post("/upload-sessions", "203.0.113.1").send(malformed(2 * MB));

    expect([401, 403]).toContain(res.status);
    expect(res.body.code).not.toBe("invalid_json");
  });

  it("does not let an anonymous chunked body without a declared length be read", async () => {
    const status = await rawPost(
      "/upload-sessions",
      "203.0.113.2",
      { "Transfer-Encoding": "chunked" },
      [Buffer.from(malformed(2 * MB))],
    );

    expect([401, 403]).toContain(status.status);
    expect(status.body).not.toContain("invalid_json");
  });

  it("refuses a compressed body with 415 on the upload-session and tool-result paths", async () => {
    const body = gzipSync(JSON.stringify({}));
    const gzip = { "Content-Encoding": "gzip" };
    const upload = await rawPost("/upload-sessions", "203.0.113.3", gzip, [body]);
    // The tool-result path checks the session first, then refuses the encoding.
    const toolResult = await rawPost("/word-chat/tool-result", "203.0.113.3", { ...gzip, Authorization: "Bearer live-token" }, [body]);

    expect(upload.status).toBe(415);
    expect(JSON.parse(upload.body).code).toBe("unsupported_content_encoding");
    expect(toolResult.status).toBe(415);
    expect(JSON.parse(toolResult.body).code).toBe("unsupported_content_encoding");
  });

  it("answers an anonymous small malformed body on an auth route as before", async () => {
    const res = await post("/auth/login", "203.0.113.4").send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_json");
  });

  it("counts anonymous upload-session requests per address before the router", async () => {
    const client = "203.0.113.5";
    for (let i = 0; i < 5; i++) {
      expect((await post("/upload-sessions", client).send({})).status).toBe(403);
    }

    const limited = await post("/upload-sessions", client).send({});

    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("rate_limited");
    expect(Object.keys(limited.headers).some((name) => name.startsWith("ratelimit"))).toBe(true);
  });

  it("does not spend the address lane on signed-in upload-session requests", async () => {
    const client = "203.0.113.9";
    for (let i = 0; i < 12; i++) {
      const poll = await request(app)
        .get(`/upload-sessions/${SESSION_ID}`)
        .set("X-Forwarded-For", client)
        .set("Authorization", "Bearer live-token");
      expect(poll.status).toBe(200);
    }
    // A signed-in request that the route refuses is bounded per user, not here.
    for (let i = 0; i < 12; i++) {
      const refused = await post("/upload-sessions", client).set("Authorization", "Bearer live-token").send({});
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect([401, 403, 429]).not.toContain(refused.status);
    }

    // The lane is still whole: only requests without a signed-in user count.
    for (let i = 0; i < 5; i++) {
      expect((await post("/upload-sessions", client).send({})).status).toBe(403);
    }
    expect((await post("/upload-sessions", client).send({})).status).toBe(429);
  });
});

describe("body admission for an authenticated caller", () => {
  const save = (body: string, client: string) =>
    post(`/single-documents/${DOC_ID}/versions/markdown`, client)
      .set("Authorization", "Bearer live-token")
      .send(body);

  it("reads a 5 MB body for a route that takes large bodies, with one identity lookup", async () => {
    const res = await save(padded(5 * MB), "203.0.113.6");

    // The router answered (the stand-in database has no such document); the
    // body was neither refused as too large nor as unauthenticated.
    expect([401, 413, 400]).not.toContain(res.status);
    expect(userLookups).toBe(1);
  });

  it("treats an authenticated small body as before", async () => {
    const small = await save(padded(1024), "203.0.113.7");
    const large = await save(padded(5 * MB), "203.0.113.7");

    expect([401, 413, 400]).not.toContain(small.status);
    expect(small.status).toBe(large.status);
    expect(userLookups).toBe(2);
  });

  it("refuses an authenticated body above the large ceiling", async () => {
    const res = await save(padded(51 * MB), "203.0.113.8");

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("request_too_large");
  });
});

// The gateway in front of the API deletes content-length and streams the body,
// so every browser request with a body reaches the backend chunked.
describe("a JSON body with no declared length", () => {
  const login = (client: string, chunks: Buffer[], length?: number) =>
    rawPost(
      "/auth/login",
      client,
      { Origin: ORIGIN, ...(length === undefined ? {} : { "Content-Length": String(length) }) },
      chunks,
    );
  const credentials = Buffer.from(JSON.stringify({ email: "owner@example.test", password: "wrong-password-1" }));

  it("reaches an anonymous route like the same request with a declared length", async () => {
    const chunked = await login("203.0.113.20", split(credentials, 10));
    const declared = await login("203.0.113.21", [credentials], credentials.length);

    expect(declared.status).toBe(400);
    expect(JSON.parse(declared.body).code).toBe("invalid_credentials");
    expect(chunked.status).toBe(declared.status);
    expect(withoutRequestId(chunked.body)).toEqual(withoutRequestId(declared.body));
  });

  it("answers a malformed or empty body like the same request with a declared length", async () => {
    const bad = Buffer.from('{"email":');
    const chunkedBad = await login("203.0.113.22", split(bad, 4));
    const declaredBad = await login("203.0.113.23", [bad], bad.length);
    const chunkedEmpty = await login("203.0.113.24", []);
    const declaredEmpty = await login("203.0.113.25", [], 0);

    expect(declaredBad.status).toBe(400);
    expect(JSON.parse(declaredBad.body).code).toBe("invalid_json");
    expect(chunkedBad.status).toBe(declaredBad.status);
    expect(withoutRequestId(chunkedBad.body)).toEqual(withoutRequestId(declaredBad.body));
    expect(chunkedEmpty.status).toBe(declaredEmpty.status);
    expect(withoutRequestId(chunkedEmpty.body)).toEqual(withoutRequestId(declaredEmpty.body));
  });

  it("is refused by authentication past the cap, without parsing it or reading much more", async () => {
    const pieces = split(Buffer.from(malformed(2 * MB)), 64 * 1024);
    const answer = await rawPost("/upload-sessions", "203.0.113.26", {}, pieces);

    expect([401, 403]).toContain(answer.status);
    expect(answer.body).not.toContain("invalid_json");
    // bytesRead is what the server had taken off the socket when it answered:
    // it stopped near the cap (plus what one read and the socket buffer hold)
    // while the caller still had most of the 2 MB to send.
    expect(seen.bytesRead).toBeLessThan(MB + 512 * 1024);
  });

  it("reads the whole body for an authenticated caller, with one identity lookup", async () => {
    // A 3-byte character starts one byte before the cap and a chunk boundary
    // falls inside it.
    const prefix = `{"base_version_id":"${USER_ID}","text":"`;
    const text = "a".repeat(MB - Buffer.byteLength(prefix) - 1) + "€" + "b".repeat(4 * MB);
    const payload = Buffer.from(`${prefix}${text}"}`);
    expect(payload.indexOf(Buffer.from("€"))).toBe(MB - 1);

    const res = await rawPost(
      `/single-documents/${DOC_ID}/versions/markdown`,
      "203.0.113.27",
      { Authorization: "Bearer live-token" },
      split(payload, MB / 16),
    );

    expect([401, 413, 400]).not.toContain(res.status);
    expect(userLookups).toBe(1);
    expect(seen.body?.text).toHaveLength(text.length);
    expect(seen.body?.text).toBe(text);
  });

  it("still serves an authenticated small body and still refuses a compressed one", async () => {
    const small = Buffer.from(JSON.stringify({ text: "hello", base_version_id: USER_ID }));
    const res = await rawPost(
      `/single-documents/${DOC_ID}/versions/markdown`,
      "203.0.113.28",
      { Authorization: "Bearer live-token" },
      split(small, 7),
    );
    expect([401, 413, 400]).not.toContain(res.status);
    expect(seen.body?.text).toBe("hello");
    expect(userLookups).toBe(1);

    const gzip = await rawPost("/upload-sessions", "203.0.113.29", { "Content-Encoding": "gzip" }, split(gzipSync("{}"), 5));
    expect(gzip.status).toBe(415);
  });

  it("answers when an earlier parser on the path has already read the body", async () => {
    // The Word tool-result path has its own, smaller parser ahead of this one.
    const body = Buffer.from(JSON.stringify({ tool_call_id: "not-a-uuid", result: "ok" }));
    const answer = await Promise.race([
      rawPost("/word-chat/tool-result", "203.0.113.31", { Authorization: "Bearer live-token" }, split(body, 8)),
      new Promise<"no answer">((resolve) => setTimeout(() => resolve("no answer"), 3000)),
    ]);
    expect(answer).not.toBe("no answer");
    expect((answer as { status: number }).status).toBe(400);
    expect(userLookups).toBe(1);
  });

  it("does not parse a Word tool-result body for an anonymous caller", async () => {
    const res = await post("/word-chat/tool-result", "203.0.113.32").send(malformed(MB + 4096));

    expect([401, 403]).toContain(res.status);
    expect(res.body.code).not.toBe("invalid_json");
    const small = await post("/word-chat/tool-result", "203.0.113.32").send('{"tool_call_id":');
    expect([401, 403]).toContain(small.status);
  });

  it("survives the caller disconnecting while its first bytes are being read", async () => {
    const address = server.address() as AddressInfo;
    const req = http.request({
      host: "127.0.0.1", port: address.port, path: "/auth/login", method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": "203.0.113.30" },
    });
    req.on("error", () => undefined);
    req.write('{"email":"owner@example.test","pass');
    await new Promise((r) => setTimeout(r, 100));
    const dropped = seen.request!;
    req.destroy();
    await new Promise((r) => setTimeout(r, 200));

    // Nothing is left listening on the dead request, and the server goes on.
    expect(dropped.listenerCount("data")).toBe(0);
    expect(dropped.listenerCount("end")).toBe(0);
    expect((await request(app).get("/health")).status).toBe(200);
  });
});
