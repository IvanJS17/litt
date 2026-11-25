import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sendDocumentDisplay } from "../documentDisplay";

// A display built in memory is sent over a real connection. A client that
// stops reading must not keep the file for good: the response is closed after
// a time with no progress, and a client that reads gets the whole file.
const SIZE = 48 * 1024 * 1024;

let server: http.Server;
let port: number;
let closed: Promise<{ sent: number }>;

beforeEach(async () => {
  process.env.DISPLAY_SEND_IDLE_MS = "300";
  let responseClosed: (outcome: { sent: number }) => void = () => undefined;
  closed = new Promise((resolve) => (responseClosed = resolve));
  const app = express();
  app.get("/display", (_req, res) => {
    const socket = res.socket!;
    res.once("close", () => responseClosed({ sent: socket.bytesWritten }));
    sendDocumentDisplay(res, { bytes: Buffer.alloc(SIZE, 1), contentType: "application/pdf", filename: "Big.pdf" });
  });
  app.get("/late", (_req, res) => {
    setTimeout(() => res.send("late answer"), 1_500);
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  delete process.env.DISPLAY_SEND_IDLE_MS;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function request(read: boolean): Promise<{ socket: net.Socket; received: () => number }> {
  return new Promise((resolve) => {
    let bytes = 0;
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write("GET /display HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      socket.on("data", (chunk) => (bytes += chunk.length));
      if (!read) socket.pause();
      resolve({ socket, received: () => bytes });
    });
    socket.on("error", () => undefined);
  });
}

describe("sending a display built in memory", () => {
  it("closes the response of a client that stops reading, without having sent the whole file", async () => {
    const client = await request(false);
    const outcome = await Promise.race([
      closed,
      new Promise<"still open">((resolve) => setTimeout(() => resolve("still open"), 5_000)),
    ]);
    expect(outcome).not.toBe("still open");
    // What the client can still read is what had already left: not the whole file.
    client.socket.resume();
    await new Promise((resolve) => client.socket.once("close", resolve));
    expect(client.received()).toBeLessThan(SIZE);
  }, 15_000);

  it("sends the whole file to a client that reads it", async () => {
    const client = await request(true);
    expect((await closed).sent).toBeGreaterThan(SIZE);
    await new Promise((resolve) => client.socket.once("close", resolve));
    expect(client.received()).toBeGreaterThan(SIZE);
  }, 15_000);

  it("leaves the connection to the request that follows on it, however long that one takes", async () => {
    const answer = await new Promise<string>((resolve) => {
      let tail = "";
      const socket = net.connect(port, "127.0.0.1", () => {
        // Both requests are sent at once; the second is answered after the display.
        socket.write(
          "GET /display HTTP/1.1\r\nHost: localhost\r\n\r\n" +
            "GET /late HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        );
      });
      socket.on("data", (chunk) => (tail = (tail + chunk.toString("latin1")).slice(-64)));
      socket.on("error", () => undefined);
      socket.on("close", () => resolve(tail));
    });
    expect(answer.endsWith("late answer")).toBe(true);
  }, 15_000);
});
