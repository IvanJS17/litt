import { afterEach, describe, expect, it, vi } from "vitest";

const reportError = vi.hoisted(() => vi.fn());
vi.mock("./observability/report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./observability/report")>()),
  reportError,
}));

import express from "express";
import request from "supertest";
import { SCHEMA_OUT_OF_DATE_MESSAGE, sendInternalError } from "./httpError";

function appThatFails(error: unknown, status?: number) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.requestId = "req-abc";
    next();
  });
  // Mounted the way app.ts mounts every feature router.
  const projects = express.Router();
  projects.get("/:projectId", (_req, res) => {
    sendInternalError(res, error, status);
  });
  app.use("/projects", projects);
  return app;
}

describe("sendInternalError", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("answers 500 with the fixed body and logs the request id, never the query", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("relation private_table does not exist");

    const res = await request(appThatFails(failure)).get("/projects/p-123?code=private-oauth-code&state=private-oauth-state");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: "internal_error",
      detail: "Something went wrong. Please try again.",
      request_id: "req-abc",
    });
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(failure, {
      tags: {
        component: "http",
        http_status: 500,
        request_id: "req-abc",
        http_method: "GET",
        // Grouping key: the MOUNTED Express route pattern, not the concrete
        // URL and not the router-relative "/:projectId".
        http_route: "/projects/:projectId",
      },
      // The concrete path (ids, filenames) is not offered to the report; the
      // route pattern above is what identifies the endpoint.
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private-oauth");
    const logged = consoleError.mock.calls[0]?.[1] as {
      requestId: string;
      error: unknown;
    };
    expect(logged.requestId).toBe("req-abc");
    expect(logged.error).toBe(failure);
  });

  it("wraps a raw PostgREST object: stack from the caller, code kept, text dropped", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const pg = {
      code: "22P02",
      message: 'invalid input syntax for type uuid: "private-value"',
      details: null,
      hint: null,
    };

    const res = await request(appThatFails(pg)).get("/projects/p-1");

    expect(res.status).toBe(500);
    const logged = (consoleError.mock.calls[0]?.[1] as { error: Error }).error;
    expect(logged).toBeInstanceOf(Error);
    expect(logged.cause).toBe(pg);
    expect(logged.message).toBe("Dependency failure (22P02)");
    // The helper frames are dropped: the top frame is the route handler.
    expect(logged.stack!.split("\n")[1]).toContain("httpError.test");
    // The dependency's own text is reachable through the cause only.
    expect(JSON.stringify(res.body)).not.toContain("private-value");
  });

  it("passes a non-default status through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(appThatFails(new Error("upstream"), 503)).get(
      "/projects/p-1",
    );

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      code: "internal_error",
      detail: "Something went wrong. Please try again.",
      request_id: "req-abc",
    });
  });

  // GET /chat on an install whose migrations were never applied (the list
  // RPC does not exist, PGRST202) answered an opaque 500 internal_error, and
  // the operator log said nothing about migrations.
  it.each(["PGRST202", "PGRST204", "PGRST205", "42P01"])(
    "answers a schema-behind-code failure (%s) with an intentional 503, one log line, and an operator hint",
    async (code) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const pg = {
        code,
        message: "Could not find the function public.private_rpc(p_user_id) in the schema cache",
        details: "private detail",
        hint: "Perhaps you meant public.private_other",
      };

      const res = await request(appThatFails(pg)).get("/projects/p-1");

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        code: "schema_out_of_date",
        detail: SCHEMA_OUT_OF_DATE_MESSAGE,
        request_id: "req-abc",
      });
      expect(JSON.stringify(res.body)).not.toMatch(/private|schema cache/);
      // The log line carries the cause, so the code stays visible.
      const logged = (consoleError.mock.calls[0]?.[1] as { error: Error }).error;
      expect(logged.cause).toBe(pg);
      // Operator-facing, and on console.warn so the error line stays the
      // request's own failure.
      expect(consoleWarn).toHaveBeenCalledOnce();
      expect(String(consoleWarn.mock.calls[0]?.[0])).toContain("backend/migrations");
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("private");
      expect(consoleError).toHaveBeenCalledOnce();
    },
  );

  it("finds the schema code on a wrapped Error's cause and leaves look-alike code bugs as 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapped = new Error("list failed", { cause: { code: "PGRST202" } });
    expect((await request(appThatFails(wrapped)).get("/projects/p-1")).status).toBe(503);

    for (const code of ["42883", "42703", "23505"]) {
      const res = await request(appThatFails({ code })).get("/projects/p-1");
      expect(res.status).toBe(500);
      expect(res.body.code).toBe("internal_error");
    }
  });

  // /download/:token carries an HMAC-signed download token as a PATH segment,
  // so dropping the query is not enough: the operator log must not contain a
  // working credential.
  it("keeps a download grant token out of the log", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express();
    app.use((_req, res, next) => {
      res.locals.requestId = "req-dl";
      next();
    });
    const downloads = express.Router();
    downloads.get("/:token", (_req, res) => {
      sendInternalError(res, new Error("storage unavailable"));
    });
    app.use("/download", downloads);

    const res = await request(app).get("/download/signed-token-abc?expires=99");

    expect(res.status).toBe(500);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("signed-token-abc");
    expect(JSON.stringify(consoleError.mock.calls)).toContain("/download/[redacted]");
  });
});
