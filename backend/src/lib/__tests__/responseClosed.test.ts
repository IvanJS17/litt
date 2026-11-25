import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { abortOnClose, onResponseClosed } from "../responseClosed";

// The signal a route passes on for "nobody can receive this response any
// more", over real connections: a client that left before the handler ran, and
// a response waiting behind an earlier one on its connection, which does not
// close when its client leaves.

let server: http.Server | undefined;

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
  server = undefined;
});

async function listen(handler: http.RequestListener): Promise<number> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

const get = (path: string) => `GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`;
const settled = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("abortOnClose", () => {
  it("is already aborted for a response whose client left before it was asked for", async () => {
    let signal: AbortSignal | undefined;
    const port = await listen(async (_req, res) => {
      await new Promise((resolve) => res.once("close", resolve));
      signal = abortOnClose(res);
    });
    const socket = net.connect(port, "127.0.0.1", () => socket.write(get("/"), () => socket.destroy()));
    socket.on("error", () => undefined);
    await expect.poll(() => signal?.aborted).toBe(true);
  });

  it("aborts when the response closes, and its connection carries no more after twelve than after one", async () => {
    const signals: AbortSignal[] = [];
    const listeners: number[] = [];
    const port = await listen((req, res) => {
      signals.push(abortOnClose(res));
      res.once("close", () => setImmediate(() => listeners.push(req.socket.listenerCount("close"))));
      res.end("ok");
    });
    // Twelve requests, one after another, on one connection.
    await new Promise<void>((resolve) => {
      let answered = 0;
      const socket = net.connect(port, "127.0.0.1", () => socket.write(get("/")));
      socket.on("data", () => {
        answered += 1;
        if (answered < 12) socket.write(get("/"));
        else socket.destroy();
      });
      socket.on("close", () => resolve());
    });
    await settled();
    expect(signals).toHaveLength(12);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    // What is on the connection after the twelfth is what was there after the first.
    expect(listeners[11]).toBe(listeners[0]);
  });

  it("aborts for a response waiting behind an earlier one on its connection when the client leaves", async () => {
    let waiting: AbortSignal | undefined;
    const port = await listen((req, res) => {
      // The first is never answered, so the second waits for the connection.
      if (req.url === "/second") waiting = abortOnClose(res);
    });
    const socket = net.connect(port, "127.0.0.1", () => socket.write(get("/first") + get("/second")));
    socket.on("error", () => undefined);
    await expect.poll(() => waiting).toBeDefined();
    expect(waiting!.aborted).toBe(false);
    socket.destroy();
    await expect.poll(() => waiting!.aborted).toBe(true);
  });

  it("adds one listener to a connection however many of its responses are waited for", async () => {
    const counts: number[] = [];
    const port = await listen((req, res) => {
      abortOnClose(res);
      counts.push(req.socket.listenerCount("close"));
    });
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write(Array.from({ length: 12 }, (_value, index) => get(`/${index}`)).join("")),
    );
    socket.on("error", () => undefined);
    await expect.poll(() => counts.length).toBe(12);
    socket.destroy();
    expect(counts[11]).toBe(counts[0]);
  });

  it("runs its listener once when the response closes and then its connection does", async () => {
    let runs = 0;
    const port = await listen((_req, res) => {
      onResponseClosed(res, () => (runs += 1));
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => socket.write(get("/")));
      socket.on("data", () => socket.destroy());
      socket.on("close", () => resolve());
    });
    await settled();
    expect(runs).toBe(1);
  });

  it("is already aborted for a waiting response whose client left before it was asked for", async () => {
    let waiting: AbortSignal | undefined;
    const port = await listen(async (req, res) => {
      if (req.url !== "/second") return;
      await new Promise((resolve) => req.socket.once("close", resolve));
      waiting = abortOnClose(res);
    });
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write(get("/first") + get("/second"), () => socket.destroy()),
    );
    socket.on("error", () => undefined);
    await expect.poll(() => waiting?.aborted).toBe(true);
  });

  it("aborts every response that waits on a connection when its client leaves", async () => {
    const waiting: AbortSignal[] = [];
    const port = await listen((req, res) => {
      if (req.url !== "/first") waiting.push(abortOnClose(res));
    });
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write(get("/first") + get("/second") + get("/third") + get("/fourth")),
    );
    socket.on("error", () => undefined);
    await expect.poll(() => waiting.length).toBe(3);
    socket.destroy();
    await expect.poll(() => waiting.map((signal) => signal.aborted)).toEqual([true, true, true]);
  });

  it("runs the rest of what waits on a connection when one of them throws", async () => {
    const ran: string[] = [];
    let seen = 0;
    const port = await listen((req, res) => {
      if (req.url === "/first") return;
      const name = req.url!;
      onResponseClosed(res, () => {
        ran.push(name);
        if (name === "/second") throw new Error("listener failed");
      });
      seen += 1;
    });
    // The failure still surfaces, once everything waiting has run.
    const surfaced: unknown[] = [];
    const onUncaught = (error: unknown) => surfaced.push(error);
    const others = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");
    process.on("uncaughtException", onUncaught);
    try {
      const socket = net.connect(port, "127.0.0.1", () =>
        socket.write(get("/first") + get("/second") + get("/third") + get("/fourth")),
      );
      socket.on("error", () => undefined);
      await expect.poll(() => seen).toBe(3);
      socket.destroy();
      await expect.poll(() => ran).toEqual(["/second", "/third", "/fourth"]);
      await expect.poll(() => surfaced).toHaveLength(1);
    } finally {
      process.off("uncaughtException", onUncaught);
      for (const listener of others) process.on("uncaughtException", listener);
    }
  });

  it("leaves a response on another connection alone when a client leaves", async () => {
    const signals = new Map<string, AbortSignal>();
    const port = await listen((req, res) => {
      signals.set(req.url!, abortOnClose(res));
    });
    const staying = net.connect(port, "127.0.0.1", () => staying.write(get("/staying")));
    const leaving = net.connect(port, "127.0.0.1", () => leaving.write(get("/leaving")));
    staying.on("error", () => undefined);
    leaving.on("error", () => undefined);
    await expect.poll(() => signals.size).toBe(2);
    leaving.destroy();
    await expect.poll(() => signals.get("/leaving")!.aborted).toBe(true);
    await settled();
    expect(signals.get("/staying")!.aborted).toBe(false);
    staying.destroy();
  });

  it("does not abort a waiting response while its client is there, and it is sent in its turn", async () => {
    let waiting: AbortSignal | undefined;
    let answerFirst: () => void = () => undefined;
    const port = await listen((req, res) => {
      if (req.url === "/first") answerFirst = () => res.end("first");
      else {
        waiting = abortOnClose(res);
        res.end("second");
      }
    });
    const received = await new Promise<string>((resolve) => {
      let text = "";
      const socket = net.connect(port, "127.0.0.1", () => socket.write(get("/first") + get("/second")));
      socket.on("data", (chunk) => {
        text += chunk.toString("latin1");
        if (text.endsWith("second")) {
          socket.destroy();
          resolve(text);
        }
      });
      void (async () => {
        await expect.poll(() => waiting).toBeDefined();
        await settled();
        expect(waiting!.aborted).toBe(false);
        answerFirst();
      })();
    });
    expect(received).toContain("first");
    expect(received.endsWith("second")).toBe(true);
    await expect.poll(() => waiting!.aborted).toBe(true);
  });
});
