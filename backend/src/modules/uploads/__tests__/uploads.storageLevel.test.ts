import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Opening an upload session says whether the space the files go to is almost
// full (from 80 % of its limit), without ever carrying a figure. The level is
// computed from the one read of the space's use made for the request, before
// the new files are counted. It is said only to a person whose space it is:
// their own personal space, or a firm they belong to.

const USER = "11111111-1111-4111-8111-111111111111";
const FIRM = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const OTHER_PERSON = "22222222-2222-4222-8222-222222222222";
const DOCUMENT = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  /** Answers of `storage_space_usage` by space: "personal" or "firm". */
  usage: {
    personal: { used_bytes: 0, limit_bytes: 1000 },
    firm: { used_bytes: 0, limit_bytes: 1000 },
  } as Record<string, { used_bytes: number; limit_bytes: number }>,
  rpc: vi.fn(),
  /** Whether the person is a member of the firm. */
  member: true,
  /** Whose personal document a new version is added to. */
  documentOwner: "11111111-1111-4111-8111-111111111111",
}));

vi.mock("../../../middleware/auth", () => ({
  requireAuth: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.locals.userId = "11111111-1111-4111-8111-111111111111";
    res.locals.userEmail = "member@example.com";
    next();
  },
}));

vi.mock("../../../lib/supabase", () => ({
  createServerSupabase: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "is", "order", "limit"])
        query[method] = () => query;
      query.maybeSingle = async () => ({
        data:
          table === "projects"
            ? { org_id: "33333333-3333-4333-8333-333333333333" }
            : table === "organizations"
              ? { kind: "team" }
              : table === "org_members"
                ? mocks.member
                  ? { role: "member" }
                  : null
                : table === "documents"
                  ? { org_id: null, user_id: mocks.documentOwner }
                  : null,
        error: null,
      });
      return query;
    },
  }),
}));

vi.mock("../uploads.access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../uploads.access")>()),
  validateDestinationAccess: async () => ({ ok: true }),
}));

vi.mock("../../../lib/storage", () => ({
  storageEnabled: true,
  getSignedUploadUrl: async () => "https://upload.example/signed",
  copyFile: vi.fn(),
  deleteFile: vi.fn(),
  deleteFileBestEffort: vi.fn(async () => undefined),
  deleteFilesBestEffort: vi.fn(async () => undefined),
  headFile: vi.fn(),
}));

import { storageLevel } from "../../../lib/storageQuota";
import { uploadSessionsRouter } from "../uploads.routes";

const app = express();
app.use(express.json());
app.use("/upload-sessions", uploadSessionsRouter);

const personalUpload = {
  purpose: "document_create",
  destination: { scope: "standalone" },
  files: [{ client_id: "a", filename: "a.pdf", size_bytes: 10 }],
};
const firmUpload = {
  purpose: "document_create",
  destination: { scope: "project", project_id: PROJECT },
  files: [{ client_id: "a", filename: "a.pdf", size_bytes: 10 }],
};

const newVersion = {
  purpose: "document_version_create",
  destination: { document_id: DOCUMENT, base_version_id: PROJECT, generate_pdf: false },
  files: [{ client_id: "edit", filename: "contract.docx", size_bytes: 10 }],
};

const usageReads = () =>
  mocks.rpc.mock.calls.filter(([name]) => name === "storage_space_usage").length;

describe("opening an upload session says how full the space is", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usage.personal = { used_bytes: 0, limit_bytes: 1000 };
    mocks.usage.firm = { used_bytes: 0, limit_bytes: 1000 };
    mocks.member = true;
    mocks.documentOwner = USER;
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "storage_space_usage") {
        const row = args.p_org_id ? mocks.usage.firm : mocks.usage.personal;
        return { data: [row], error: null };
      }
      return { error: null };
    });
  });

  it.each([
    [799, "ok"],
    [800, "almostFull"],
    [801, "almostFull"],
    [999, "almostFull"],
  ])("a personal space using %i of 1000 is %s", async (used, level) => {
    mocks.usage.personal = { used_bytes: used, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(personalUpload);
    expect(response.status).toBe(201);
    expect(response.body.storageLevel).toBe(level);
  });

  it("counts the use before the files being opened, not after them", async () => {
    // 790 used + 10 for the file = 800: still below the line before the file.
    mocks.usage.personal = { used_bytes: 790, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(personalUpload);
    expect(response.body.storageLevel).toBe("ok");
  });

  it("leaves the refusal at the limit unchanged", async () => {
    mocks.usage.personal = { used_bytes: 1000, limit_bytes: 1000 };
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "storage_space_usage"
        ? { data: [mocks.usage.personal], error: null }
        : { error: { message: "storage_quota_exceeded" } },
    );
    const response = await request(app).post("/upload-sessions").send(personalUpload);
    expect(response.status).toBe(413);
    expect(response.body.code).toBe("storage_quota_exceeded");
    expect(response.body).not.toHaveProperty("storageLevel");
  });

  it("says the level of the firm's space to a member, with no figure anywhere in the answer", async () => {
    mocks.usage.firm = { used_bytes: 900, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(firmUpload);
    expect(response.status).toBe(201);
    expect(response.body.storageLevel).toBe("almostFull");
    expect(response.body.storageSpace).toEqual({ kind: "firm", id: FIRM });
    const text = JSON.stringify(response.body);
    expect(text).not.toMatch(/900|limit_bytes|used_bytes|usedBytes|limitBytes/);
  });

  it("is the level of the space the upload goes to, not of the person's other space", async () => {
    mocks.usage.personal = { used_bytes: 1000, limit_bytes: 1000 };
    mocks.usage.firm = { used_bytes: 10, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(firmUpload);
    expect(response.body.storageLevel).toBe("ok");
    const own = await request(app).post("/upload-sessions").send(personalUpload);
    expect(own.body.storageLevel).toBe("almostFull");
    expect(own.body.storageSpace).toEqual({ kind: "personal", id: USER });
  });

  it("says the level to a person who adds a version to their own document", async () => {
    mocks.usage.personal = { used_bytes: 950, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(newVersion);
    expect(response.status).toBe(201);
    expect(response.body.storageLevel).toBe("almostFull");
    expect(response.body.storageSpace).toEqual({ kind: "personal", id: USER });
  });

  it("says nothing of another person's space to someone who adds a version to that person's document", async () => {
    mocks.documentOwner = OTHER_PERSON;
    mocks.usage.personal = { used_bytes: 950, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(newVersion);
    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty("storageLevel");
    expect(response.body).not.toHaveProperty("storageSpace");
    expect(JSON.stringify(response.body)).not.toContain(OTHER_PERSON);
    expect(usageReads()).toBe(0);
  });

  it("says nothing of a firm's space to someone who is not a member of it", async () => {
    mocks.member = false;
    mocks.usage.firm = { used_bytes: 950, limit_bytes: 1000 };
    const response = await request(app).post("/upload-sessions").send(firmUpload);
    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty("storageLevel");
    expect(response.body).not.toHaveProperty("storageSpace");
    expect(usageReads()).toBe(0);
  });

  it("reads the use of the space once per request", async () => {
    await request(app).post("/upload-sessions").send(firmUpload);
    expect(usageReads()).toBe(1);
  });

  it("does not stop an upload when the use cannot be read", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "storage_space_usage" ? { data: null, error: { message: "down" } } : { error: null },
    );
    const response = await request(app).post("/upload-sessions").send(personalUpload);
    expect(response.status).toBe(201);
    expect(response.body.storageLevel).toBe("ok");
  });
});

describe("storageLevel", () => {
  it("is almostFull from four fifths of the limit, in whole numbers", () => {
    expect(storageLevel({ usedBytes: 7999, limitBytes: 10000 })).toBe("ok");
    expect(storageLevel({ usedBytes: 8000, limitBytes: 10000 })).toBe("almostFull");
    expect(storageLevel({ usedBytes: 10000, limitBytes: 10000 })).toBe("almostFull");
  });

  it("treats a limit of zero as almost full and an empty space as ok", () => {
    expect(storageLevel({ usedBytes: 0, limitBytes: 0 })).toBe("almostFull");
    expect(storageLevel({ usedBytes: 0, limitBytes: 1 })).toBe("ok");
  });

  it("stays exact for very large spaces", () => {
    const limit = Number.MAX_SAFE_INTEGER;
    expect(storageLevel({ usedBytes: Math.floor((limit / 5) * 4) - 1, limitBytes: limit })).toBe("ok");
  });
});
