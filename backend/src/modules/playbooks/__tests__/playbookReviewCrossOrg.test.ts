// A review whose document belongs to another organization than the playbook.
// A firm's key chosen for the work runs only work whose playbook AND document
// belong to that firm; a person's own key keeps working as before.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";

const docs = vi.hoisted(() => ({
  completeText: vi.fn(),
  loadActiveVersion: vi.fn(),
  loadCurrentVersionBytes: vi.fn(),
  extractDocxBodyText: vi.fn(),
}));
vi.mock("../../../lib/llm", async (original) => ({
  ...(await original<typeof import("../../../lib/llm")>()),
  completeText: docs.completeText,
}));
vi.mock("../../documents/documents.service", async (original) => ({
  ...(await original<typeof import("../../documents/documents.service")>()),
  loadCurrentVersionBytes: docs.loadCurrentVersionBytes,
}));
vi.mock("../../../lib/documentVersions", async (original) => ({
  ...(await original<typeof import("../../../lib/documentVersions")>()),
  loadActiveVersion: docs.loadActiveVersion,
}));
vi.mock("../../../lib/docxTrackedChanges", async (original) => ({
  ...(await original<typeof import("../../../lib/docxTrackedChanges")>()),
  extractDocxBodyText: docs.extractDocxBodyText,
}));

import { blankPlaybookContent, beginPlaybookReview, runPlaybookReview } from "../playbooks.operations";
import { EXTRACTION_OPS } from "../../../lib/extraction/ops";
import { ExtractionBusyError, ExtractionLimitError } from "../../../lib/extraction/isolated";
import { keyRow } from "./playbookTestKeys";
import { database, ORG as FIRM_A, OTHER as FIRM_B } from "./playbookTestDb";

let lastTables: Record<string, Record<string, unknown>[]> = {};

async function world(documentOrg: string | null, playbookOrg: string | null = FIRM_A) {
  const { db, tables } = database(
    [
      {
        id: "book",
        user_id: playbookOrg ? "owner" : "u1",
        org_id: playbookOrg,
        visibility: playbookOrg ? "organization" : "private",
        name: "Guide",
        description: "",
        content_json: blankPlaybookContent("Guide"),
        created_at: "2026-10-17",
        updated_at: "2026-10-17",
      },
    ],
    [
      { user_id: "u1", org_id: FIRM_A, role: "member" },
      { user_id: "u1", org_id: FIRM_B, role: "member" },
    ],
  );
  lastTables = tables;
  tables.organizations!.forEach((row) => {
    row.allow_personal_ai_keys = true;
    row.authorization_epoch = 1;
  });
  tables.org_api_keys = [
    await keyRow({ kind: "org", id: FIRM_A }, "sk-firm-a"),
    await keyRow({ kind: "org", id: FIRM_B }, "sk-firm-b"),
    await keyRow({ kind: "org", id: FIRM_A }, "sk-or-firm-a", "openrouter"),
  ];
  tables.org_router_models = [
    { org_id: FIRM_A, router: "openrouter", model_id: "openai/gpt-4.1" },
  ];
  tables.user_api_keys = [await keyRow({ kind: "user", id: "u1" }, "sk-own")];
  tables.documents = [
    { id: "doc", user_id: "u1", project_id: null, workflow_id: null, org_id: documentOrg },
  ];
  return db;
}

const review = (db: Db, credentialRef?: string, model = "claude-opus-5") =>
  beginPlaybookReview({
    userId: "u1",
    playbookId: "book",
    documentId: "doc",
    model,
    reviewMode: "strict",
    credentialRef,
    db,
  });

beforeEach(() => {
  vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
  for (const name of ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]) vi.stubEnv(name, "");
  docs.loadActiveVersion.mockResolvedValue({ id: "v1", filename: "msa.docx", file_type: "docx" });
  docs.loadCurrentVersionBytes.mockResolvedValue({ bytes: Buffer.from(""), storage_path: "p" });
  docs.extractDocxBodyText.mockResolvedValue("Contract text");
});
afterEach(() => vi.unstubAllEnvs());

describe("reviewing a document of another organization with a playbook of this one", () => {
  const firmAKey = `org:${FIRM_A}:claude:v1`;

  it("runs on the firm's key when playbook and document both belong to that firm", async () => {
    const started = await review(await world(FIRM_A), firmAKey);
    expect(started.resolved.route.credentialRef).toBe(firmAKey);
  });

  it.each([
    ["a document of another firm", FIRM_B],
    ["a personal document", null],
  ])("refuses the firm's key for %s", async (_name, documentOrg) => {
    await expect(review(await world(documentOrg), firmAKey)).rejects.toMatchObject({
      status: 409,
      code: "chat_route_credential_unavailable",
    });
  });

  it("refuses the key of the document's firm for a playbook of another firm or a personal one", async () => {
    const firmBKey = `org:${FIRM_B}:claude:v1`;
    await expect(review(await world(FIRM_B, FIRM_A), firmBKey)).rejects.toMatchObject({
      code: "chat_route_credential_unavailable",
    });
    await expect(review(await world(FIRM_B, null), firmBKey)).rejects.toMatchObject({
      code: "chat_route_credential_unavailable",
    });
  });

  it("answers with that code, not a model or key-missing one, whatever the model", async () => {
    await expect(
      review(await world(FIRM_B), `org:${FIRM_A}:openrouter:v1`, "openrouter/openai/gpt-4.1"),
    ).rejects.toMatchObject({ status: 409, code: "chat_route_credential_unavailable" });
  });

  it("keeps the person's own key working for it, as before (open question for the owner)", async () => {
    const started = await review(await world(FIRM_B), "user:u1:claude:v1");
    expect(started.resolved.route.credentialRef).toBe("user:u1:claude:v1");
  });
});

describe("the model of a review is trimmed and governed as in the other flows", () => {
  const firmOpenRouter = `org:${FIRM_A}:openrouter:v1`;

  it("runs a model sent with surrounding whitespace on the trimmed id", async () => {
    const started = await review(
      await world(FIRM_A), firmOpenRouter, " openrouter/openai/gpt-4.1 ",
    );
    expect(started.resolved.route.model).toBe("openrouter/openai/gpt-4.1");
  });

  it.each([
    ["an unapproved model with trailing whitespace", "openrouter/openai/gpt-5-pro "],
    ["an id the catalog does not recognise", "openrouter/auto"],
  ])("refuses %s on the firm's key, recording nothing", async (_name, model) => {
    const db = await world(FIRM_A);
    await expect(review(db, firmOpenRouter, model)).rejects.toMatchObject({
      status: 400,
      code: "model_unavailable",
    });
  });
});

describe("the text of the document under review is read by the parser process", () => {
  it("asks the parser for the body text and does not read the file here", async () => {
    const parse = vi.spyOn(EXTRACTION_OPS, "docxBodyText").mockResolvedValue("From the parser.");
    try {
      await review(await world(FIRM_A));
      expect(parse).toHaveBeenCalledTimes(1);
      expect(docs.extractDocxBodyText).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });

  it("answers a 400 with the too-large code when the parser's limits stop the file", async () => {
    const parse = vi.spyOn(EXTRACTION_OPS, "docxBodyText").mockRejectedValue(new ExtractionLimitError("parser deadline exceeded"));
    try {
      await expect(review(await world(FIRM_A))).rejects.toMatchObject({ status: 400, code: "request_too_large" });
    } finally { parse.mockRestore(); }
  });

  it("lets a busy parser through as the typed busy error", async () => {
    const parse = vi.spyOn(EXTRACTION_OPS, "docxBodyText").mockRejectedValue(new ExtractionBusyError());
    try {
      await expect(review(await world(FIRM_A))).rejects.toBeInstanceOf(ExtractionBusyError);
    } finally { parse.mockRestore(); }
  });

  it("answers a 400 for a file the parser cannot read", async () => {
    const parse = vi.spyOn(EXTRACTION_OPS, "docxBodyText").mockRejectedValue(new Error("not a zip"));
    try {
      await expect(review(await world(FIRM_A))).rejects.toMatchObject({ status: 400 });
    } finally { parse.mockRestore(); }
  });
});

describe("a firm that forbids personal keys for the document under review", () => {
  const forbid = (org: string) => {
    lastTables.organizations!.find((row) => row.id === org)!.allow_personal_ai_keys = false;
  };

  it.each([
    ["a personal playbook", null],
    ["a playbook of another firm that allows personal keys", FIRM_A],
  ])("does not pin the member's own key for %s", async (_name, playbookOrg) => {
    const db = await world(FIRM_B, playbookOrg);
    forbid(FIRM_B);
    await expect(review(db)).rejects.toMatchObject({ status: 409, code: "chat_route_credential_required" });
  });

  it("refuses a personal key named for it", async () => {
    const db = await world(FIRM_B, null);
    forbid(FIRM_B);
    await expect(review(db, "user:u1:claude:v1")).rejects.toMatchObject({
      status: 409,
      code: "chat_route_credential_unavailable",
    });
  });

  it("still pins the member's own key for a firm that allows them", async () => {
    const started = await review(await world(FIRM_B, null));
    expect(started.resolved.route.credentialRef).toBe("user:u1:claude:v1");
  });

  it("does not run a recorded review on a personal key once the firm forbids them", async () => {
    const db = await world(FIRM_B, null);
    const started = await review(db, "user:u1:claude:v1");
    forbid(FIRM_B);
    docs.completeText.mockResolvedValue("{}");
    await runPlaybookReview(db, started.work).catch(() => undefined);
    expect(docs.completeText).not.toHaveBeenCalled();
  });
});
