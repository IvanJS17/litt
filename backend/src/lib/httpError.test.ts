import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INTERNAL_ERROR_CODE,
  INTERNAL_ERROR_MESSAGE,
  sendInternalError,
} from "./httpError";

function appThatFails(error: unknown) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.requestId = "req-http-123";
    next();
  });
  app.get("/projects/:projectId", (_req, res) => sendInternalError(res, error));
  app.get("/download/:token", (_req, res) => sendInternalError(res, error));
  return app;
}

describe("sendInternalError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("omits the query string (OAuth code/state) from the logged path", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await request(appThatFails(new Error("boom"))).get(
      "/projects/p-123?code=private-oauth-code&state=private-oauth-state",
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: INTERNAL_ERROR_CODE,
      detail: INTERNAL_ERROR_MESSAGE,
      request_id: "req-http-123",
    });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("private-oauth");
    expect(logged).toContain("/projects/p-123");
  });

  it("masks the download token carried in the path", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await request(appThatFails(new Error("stream failed"))).get(
      "/download/private-signed-download-token",
    );

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("private-signed-download-token");
    expect(logged).toContain("/download/[redacted]");
  });
});
