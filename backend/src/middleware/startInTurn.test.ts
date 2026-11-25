import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { startInTurn } from "./startInTurn";

// Requests a client sends on one connection without waiting for the answers,
// over real connections: each starts in its turn and in its own context, and
// a connection that sends more than it waits for is closed.

let server: http.Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = undefined;
});

async function listen(app: express.Express): Promise<number> {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server!.once("listening", resolve));
  return (server!.address() as AddressInfo).port;
}

const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`;

/** Sends `requests` at once; resolves with what came back when the connection closes or after `waitMs`. */
function sendAtOnce(port: number, requests: string, waitMs: number) {
  return new Promise<{ text: string; closed: boolean }>((resolve) => {
    let text = "";
    let closed = false;
    const socket = net.connect(port, "127.0.0.1", () => socket.write(requests));
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ text, closed });
    };
    const timer = setTimeout(finish, waitMs);
    socket.on("data", (chunk) => (text += chunk.toString("latin1")));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      closed = true;
      finish();
    });
  });
}

describe("startInTurn", () => {
  it("is the first thing the application does with a request", () => {
    const source = readFileSync(path.join(__dirname, "..", "app.ts"), "utf8");
    expect(/^app\.use\(\s*([^\s,)]+)/m.exec(source)?.[1]).toBe("startInTurn");
  });

  it("starts a waiting request only when the one ahead of it has been answered", async () => {
    const started: string[] = [];
    let answerFirst: () => void = () => undefined;
    const app = express();
    app.use(startInTurn);
    app.use((req, res) => {
      started.push(req.url);
      if (req.url === "/first") answerFirst = () => res.end("first");
      else res.end(req.url === "/second" ? "second" : "third");
    });
    const port = await listen(app);
    const answered = sendAtOnce(port, get("/first") + get("/second") + get("/third"), 2_000);
    await expect.poll(() => started).toEqual(["/first"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(started).toEqual(["/first"]);
    answerFirst();
    await expect.poll(() => started).toEqual(["/first", "/second", "/third"]);
    const { text } = await answered;
    expect(text.indexOf("first")).toBeGreaterThan(-1);
    expect(text.indexOf("first")).toBeLessThan(text.indexOf("second"));
    expect(text.indexOf("second")).toBeLessThan(text.indexOf("third"));
  });

  it("starts a waiting request in its own context, not that of the request ahead of it", async () => {
    const context = new AsyncLocalStorage<string>();
    const seenAtStart: Record<string, string | undefined> = {};
    const app = express();
    app.use(startInTurn);
    app.use(async (req, res) => {
      seenAtStart[req.url] = context.getStore();
      // What a middleware binds for the rest of its request, once it has
      // looked the caller up.
      await new Promise((resolve) => setImmediate(resolve));
      context.enterWith(req.url);
      setTimeout(() => res.end("ok"), 50);
    });
    const port = await listen(app);
    await sendAtOnce(port, get("/first") + get("/second") + get("/third"), 1_000);
    expect(seenAtStart).toEqual({ "/first": undefined, "/second": undefined, "/third": undefined });
  });

  it("serves a hundred requests sent at once behind the first", async () => {
    let answerFirst: () => void = () => undefined;
    let started = 0;
    const app = express();
    app.use(startInTurn);
    app.use((req, res) => {
      started += 1;
      if (req.url === "/first") answerFirst = () => res.end("first");
      else res.end("ok");
    });
    const port = await listen(app);
    const requests = get("/first") + Array.from({ length: 100 }, (_value, index) => get(`/${index}`)).join("");
    const answered = sendAtOnce(port, requests, 2_000);
    await expect.poll(() => started).toBe(1);
    answerFirst();
    const { text } = await answered;
    expect(started).toBe(101);
    expect(text.split("HTTP/1.1 200").length - 1).toBe(101);
  });

  it("counts only the requests that are waiting: a connection may send many more over its life", async () => {
    const app = express();
    app.use(startInTurn);
    app.use((_req, res) => setImmediate(() => res.end("ok")));
    const port = await listen(app);
    const batch = Array.from({ length: 61 }, (_value, index) => get(`/${index}`)).join("");
    let text = "";
    let closed = false;
    const socket = net.connect(port, "127.0.0.1");
    socket.on("data", (chunk) => (text += chunk.toString("latin1")));
    socket.on("error", () => undefined);
    socket.on("close", () => (closed = true));
    try {
      for (const answeredSoFar of [61, 122, 183]) {
        socket.write(batch);
        await expect.poll(() => text.split("HTTP/1.1 200").length - 1).toBe(answeredSoFar);
      }
      expect(closed).toBe(false);
    } finally {
      socket.destroy();
    }
  });

  it("counts each connection on its own: two clients with sixty waiting each are both served", async () => {
    const answerHeld: Array<() => void> = [];
    const app = express();
    app.use(startInTurn);
    app.use((req, res) => {
      if (req.url === "/held") answerHeld.push(() => res.end("ok"));
      else res.end("ok");
    });
    const port = await listen(app);
    const requests = get("/held") + Array.from({ length: 60 }, (_value, index) => get(`/${index}`)).join("");
    const first = sendAtOnce(port, requests, 2_000);
    const second = sendAtOnce(port, requests, 2_000);
    await expect.poll(() => answerHeld.length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const answer of answerHeld) answer();
    for (const { text, closed } of await Promise.all([first, second])) {
      expect(text.split("HTTP/1.1 200").length - 1).toBe(61);
      expect(closed).toBe(false);
    }
  });

  it("keeps the same limit on a connection that has already been served many requests", async () => {
    let held = 0;
    const app = express();
    app.use(startInTurn);
    app.use((req, res) => {
      // The held request is never answered.
      if (req.url === "/held") held += 1;
      else setImmediate(() => res.end("ok"));
    });
    const port = await listen(app);
    const batch = Array.from({ length: 61 }, (_value, index) => get(`/${index}`)).join("");
    let text = "";
    let closed = false;
    const socket = net.connect(port, "127.0.0.1");
    socket.on("data", (chunk) => (text += chunk.toString("latin1")));
    socket.on("error", () => undefined);
    socket.on("close", () => (closed = true));
    try {
      for (const answeredSoFar of [61, 122, 183]) {
        socket.write(batch);
        await expect.poll(() => text.split("HTTP/1.1 200").length - 1).toBe(answeredSoFar);
      }
      socket.write(get("/held") + Array.from({ length: 101 }, (_value, index) => get(`/${index}`)).join(""));
      await expect.poll(() => closed, { timeout: 5_000 }).toBe(true);
      expect(held).toBe(1);
      expect(text.split("HTTP/1.1 200").length - 1).toBe(183);
    } finally {
      socket.destroy();
    }
  });

  it("closes a connection that sends more requests than it waits for, and starts none of them", async () => {
    let started = 0;
    const app = express();
    app.use(startInTurn);
    app.use(() => {
      // The first is never answered.
      started += 1;
    });
    const port = await listen(app);
    const requests = get("/first") + Array.from({ length: 5_000 }, (_value, index) => get(`/${index}`)).join("");
    const { closed } = await sendAtOnce(port, requests, 5_000);
    expect(closed).toBe(true);
    expect(started).toBe(1);
  });
});
