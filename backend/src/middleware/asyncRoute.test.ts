import { afterEach, describe, expect, it, vi } from "vitest";

import express from "express";
import request from "supertest";
import { asyncRoute, routerErrorHandler } from "./asyncRoute";

describe("routerErrorHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("answers 500 and names the router that took the failure in the log", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("relation private_table does not exist");
    const app = express();
    const router = express.Router();
    router.get(
      "/boom",
      asyncRoute(async () => {
        throw failure;
      }),
    );
    router.use(routerErrorHandler("[test-router]"));
    app.use("/api", router);

    const res = await request(app).get("/api/boom");

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("internal_error");
    const routerLog = consoleError.mock.calls.findIndex(
      ([first]) => first === "[test-router] unhandled route error",
    );
    expect(routerLog).toBeGreaterThanOrEqual(0);
    expect(consoleError.mock.calls[routerLog]?.[1]).toBe(failure);
  });

  it("hands a failure after headers were sent to the next handler", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const app = express();
    const router = express.Router();
    router.get(
      "/stream",
      asyncRoute(async (_req, res) => {
        res.write("partial");
        throw new Error("mid-stream");
      }),
    );
    router.use(routerErrorHandler("[test-router]"));
    app.use("/api", router);

    await request(app).get("/api/stream").catch(() => undefined);
    // The response had already started, so there is no honest status left to
    // send and nothing for the router to log.
    expect(
      consoleError.mock.calls.filter(
        ([first]) => first === "[test-router] unhandled route error",
      ),
    ).toHaveLength(0);
  });
});
