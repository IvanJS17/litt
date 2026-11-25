import express from "express";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The download routes hand the object to the client as a stream. These cases
// drive the real router and storage facade against a scripted adapter, so each
// one controls exactly when the store yields, fails, or stalls. LiTT has no
// filesystem driver (and so no signed-URL route); the authenticated
// /download/:token route is driven instead, with authentication and the
// access/training gate of the service stubbed (they have their own tests) and
// the object opened through the real storage facade.

vi.hoisted(() => {
  process.env.DOWNLOAD_SIGNING_SECRET = "test-signing-secret";
  process.env.STORAGE_DOWNLOAD_TIMEOUT_MS = "10000";
});

import { headFile, openFileStream, setStorageAdapter, type StorageAdapter } from "../../lib/storage";

// A test can make the session check wait, to let a client leave first.
const auth = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock("../../middleware/auth", () => ({
  requireAuth: async (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => {
    if (auth.gate) await auth.gate;
    res.locals.userId = "u1";
    next();
  },
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: () => ({}) }));
vi.mock("../../modules/downloads/downloads.service", () => ({
  resolveTokenDownload: async () => {
    const head = await headFile("documents/u1/d1/source.pdf");
    return {
      ok: true,
      download: {
        size: head!.size,
        etag: head!.etag,
        contentType: "application/pdf",
        filename: "report.pdf",
        open: (signal: AbortSignal) => openFileStream("documents/u1/d1/source.pdf", { signal }),
      },
    };
  },
}));
import { downloadsRouter } from "../../modules/downloads/downloads.routes";

const FIRST = Buffer.from("first chunk;");
const SECOND = Buffer.from("second chunk");
const SIZE = FIRST.length + SECOND.length;

type Reader = (signal: AbortSignal | undefined) => AsyncIterable<Uint8Array>;

function adapterReading(reader: Reader): StorageAdapter {
  return {
    enabled: true,
    configurationHint: "scripted adapter",
    uploadFile: vi.fn(),
    uploadFileFromPath: vi.fn(),
    getSignedUploadUrl: vi.fn(),
    downloadFile: vi.fn(async () => {
      throw new Error("a download must not buffer the whole object");
    }),
    openReadStream: vi.fn(async (_key, options) => reader(options?.signal)),
    headFile: vi.fn(async () => ({ size: SIZE, etag: '"v1"', contentType: null })),
    listFiles: vi.fn(),
    copyFile: vi.fn(),
    deleteFile: vi.fn(),
    getSignedUrl: vi.fn(),
  };
}

const app = express();
// Other middleware may already hold a few 'close' listeners on a production
// response before the route runs, so the same load is added here.
app.use((_req, res, next) => {
  for (let i = 0; i < 4; i++) res.on("close", () => {});
  next();
});
app.use("/download", downloadsRouter);
let server: http.Server;
let base: string;
const path = () => "/download/signed-token";

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

/** GET over a real socket, calling `onChunk` as each body chunk arrives. */
function get(onChunk: (chunk: Buffer, req: http.ClientRequest) => void) {
  return new Promise<{ status: number; length: string | undefined; body: Buffer; complete: boolean }>(
    (resolve) => {
      const chunks: Buffer[] = [];
      const req = http.get(base + path(), (res) => {
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            length: res.headers["content-length"],
            body: Buffer.concat(chunks),
            complete: res.complete,
          });
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          onChunk(chunk, req);
        });
        res.on("end", done);
        res.on("close", done);
        res.on("error", () => undefined);
      });
      req.on("error", () => undefined);
    },
  );
}

describe("GET /download/:token streaming", () => {
  it("sends the first chunk before the store has produced the rest", async () => {
    let clientHasFirst!: () => void;
    const firstArrived = new Promise<void>((resolve) => (clientHasFirst = resolve));
    setStorageAdapter(
      adapterReading(async function* () {
        yield FIRST;
        // A buffered response would wait here forever: the client only
        // releases the rest once it has received the first chunk.
        await firstArrived;
        yield SECOND;
      }),
    );

    const res = await get(() => clientHasFirst());

    expect(res.status).toBe(200);
    expect(res.length).toBe(String(SIZE));
    expect(res.body.toString()).toBe("first chunk;second chunk");
  });

  it("stays under Node's listener limit on the response", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.name);
    process.on("warning", onWarning);
    setStorageAdapter(
      adapterReading(async function* () {
        yield FIRST;
        yield SECOND;
      }),
    );

    try {
      const res = await get(() => undefined);
      expect(res.body.toString()).toBe("first chunk;second chunk");
      // Process warnings are emitted on a later tick.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", onWarning);
    }

    expect(warnings).not.toContain("MaxListenersExceededWarning");
  });

  it("answers a store that fails before the first byte with an error status", async () => {
    setStorageAdapter(
      adapterReading(async function* () {
        throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      }),
    );

    const res = await request(app).get(path());

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("internal_error");
    expect(res.headers["content-disposition"]).toBeUndefined();
    // The object's validator must not be attached to the error body.
    expect(res.headers.etag).not.toBe('"v1"');
  });

  it("answers a matching If-None-Match with 304 without reading the object", async () => {
    const adapter = adapterReading(async function* () {
      yield FIRST;
      yield SECOND;
    });
    setStorageAdapter(adapter);

    const full = await request(app).get(path());
    expect(full.status).toBe(200);
    expect(full.headers.etag).toBe('"v1"');
    vi.mocked(adapter.openReadStream).mockClear();

    const revalidated = await request(app).get(path()).set("If-None-Match", '"v1"');
    expect(revalidated.status).toBe(304);
    expect(adapter.openReadStream).not.toHaveBeenCalled();
  });

  it("cancels the storage read when the client disconnects", async () => {
    let released!: (reason: unknown) => void;
    const storageReleased = new Promise((resolve) => (released = resolve));
    setStorageAdapter(
      adapterReading(async function* (signal) {
        yield FIRST;
        // Stall like a slow store; only an abort lets this read go.
        await new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => {
            released(signal.reason);
            reject(signal.reason);
          }),
        );
      }),
    );

    await get((_chunk, req) => req.destroy());

    await expect(storageReleased).resolves.toBeDefined();
  });

  it("opens no storage read for a client that left before the handler ran", async () => {
    const adapter = adapterReading(async function* () {
      yield FIRST;
      yield SECOND;
    });
    setStorageAdapter(adapter);
    let letSessionThrough: () => void = () => undefined;
    auth.gate = new Promise<void>((resolve) => (letSessionThrough = resolve));
    try {
      let gone = false;
      server.once("connection", (socket) => socket.once("close", () => (gone = true)));
      const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1", () =>
        socket.write(`GET ${path()} HTTP/1.1\r\nHost: localhost\r\n\r\n`, () => socket.destroy()),
      );
      socket.on("error", () => undefined);
      await vi.waitFor(() => expect(gone).toBe(true));
      letSessionThrough();
      // The handler has run once the service has asked the store for the size.
      await vi.waitFor(() => expect(adapter.headFile).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(adapter.openReadStream).not.toHaveBeenCalled();
    } finally {
      auth.gate = null;
      letSessionThrough();
    }
  }, 10_000);

  it("releases the storage read of a request waiting behind an earlier one on its connection when the client leaves", async () => {
    const opened: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    let released!: () => void;
    const secondReleased = new Promise<void>((resolve) => (released = resolve));
    const adapter = adapterReading(async function* () {
      yield FIRST;
      await new Promise(() => undefined);
    });
    // Each read is told apart by the order it was opened in; the second one is the waiting request's.
    vi.mocked(adapter.openReadStream).mockImplementation(async (_key, options) => {
      opened.push({ url: String(opened.length), signal: options?.signal });
      if (opened.length === 2) options?.signal?.addEventListener("abort", () => released());
      return (async function* () {
        yield FIRST;
        // Stalls like a slow store; only an abort ends it.
        await new Promise<never>((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason)),
        );
      })();
    });
    setStorageAdapter(adapter);
    const request = `GET ${path()} HTTP/1.1\r\nHost: localhost\r\n\r\n`;
    const socket = net.connect((server.address() as AddressInfo).port, "127.0.0.1", () => socket.write(request + request));
    socket.on("error", () => undefined);
    socket.on("data", () => undefined);
    try {
      await vi.waitFor(() => expect(opened).toHaveLength(2));
      socket.destroy();
      await Promise.race([
        secondReleased,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("the waiting request's read was not released")), 3_000)),
      ]);
    } finally {
      socket.destroy();
    }
  }, 10_000);

  it("ends the response short and releases the store when a read fails mid-stream", async () => {
    let finished = false;
    setStorageAdapter(
      adapterReading(async function* () {
        try {
          yield FIRST;
          throw new Error("socket hang up");
        } finally {
          finished = true;
        }
      }),
    );

    const res = await get(() => undefined);

    expect(res.status).toBe(200);
    expect(res.complete).toBe(false);
    expect(res.body.length).toBeLessThan(SIZE);
    expect(finished).toBe(true);
  });
});
