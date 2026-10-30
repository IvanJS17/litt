import { afterEach, expect, it, vi } from "vitest";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { AppError } from "../lib/appError";
import { reportError, setOperation } from "../lib/observability/report";
import { requestDiagnostics } from "./requestDiagnostics";

const PRIVATE_FILE = "Jane_Doe_NDA.pdf";
const PRIVATE_EMAIL = "jane@example.test";

afterEach(() => { vi.restoreAllMocks(); });

it("keeps each request's identity in its own sanitized report line", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const app = express();
  app.use(requestDiagnostics);
  app.use(express.json());
  let releaseDocuments!: () => void;
  const workflowStarted = new Promise<void>(resolve => { releaseDocuments = resolve; });
  app.post("/documents/:documentId", async (_req, res) => {
    // A different request changes operation while this request is suspended.
    await workflowStarted;
    reportError(new AppError("db.query_failed", PRIVATE_FILE, { cause: { code: "42501", message: PRIVATE_EMAIL } }));
    res.sendStatus(204);
  });
  app.get("/workflows/:workflowId", async (_req, res) => {
    setOperation("workflows.run");
    releaseDocuments();
    await new Promise<void>(resolve => setImmediate(resolve));
    reportError(new Error(PRIVATE_EMAIL));
    res.sendStatus(204);
  });
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    reportError(error);
    res.sendStatus(400);
  };
  app.use(handleError);
  const [documents, workflow] = await Promise.all([
    request(app).post(`/documents/${PRIVATE_FILE}?email=${PRIVATE_EMAIL}`).set("Authorization", "Bearer PRIVATE_TOKEN").send({ content: PRIVATE_FILE }),
    request(app).get(`/workflows/${PRIVATE_FILE}?email=${PRIVATE_EMAIL}`),
  ]);
  // Fails before a route is selected.
  const malformed = await request(app).post(`/documents/${PRIVATE_FILE}`).set("Content-Type", "application/json").send(`{"private":"${PRIVATE_EMAIL}"`);
  expect([documents.status, workflow.status, malformed.status]).toEqual([204, 204, 400]);

  const reports = errors.mock.calls.filter(call => call[0] === "[report]").map(call => JSON.parse(String(call[1])) as Record<string, unknown>);
  expect(reports).toHaveLength(3);
  const byRequest = (id: string) => reports.find(report => report.request_id === id);
  expect(byRequest(documents.headers["x-request-id"])).toMatchObject({
    operation: "http.request", component: "http", http_method: "POST", http_route: "/documents/:id",
    error_kind: "db.query_failed", failure_code: "42501",
  });
  expect(byRequest(workflow.headers["x-request-id"])).toMatchObject({
    operation: "workflows.run", http_method: "GET", http_route: "/workflows/:id",
  });
  expect(byRequest(malformed.headers["x-request-id"])).toMatchObject({
    operation: "http.request", http_method: "POST", http_route: "/documents/:id",
  });
  const wire = JSON.stringify(errors.mock.calls);
  for (const privateValue of [PRIVATE_FILE, PRIVATE_EMAIL, "PRIVATE_TOKEN"]) expect(wire).not.toContain(privateValue);
});
