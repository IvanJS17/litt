import { describe, expect, it, vi } from "vitest";
import { tableDb } from "../../__tests__/helpers/tableDb";
import { storageQuotaConfiguration } from "../runtimeConfig";
import {
  quotaRpcArgs,
  resolveUploadSpace,
  storageSpaceUsage,
} from "../storageQuota";
import type { Db } from "../supabase";

const GIB = 1024 ** 3;
const USER = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const FIRM = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const WORKFLOW = "55555555-5555-4555-8555-555555555555";
const DOCUMENT = "66666666-6666-4666-8666-666666666666";
const PERSONAL_ORG = "77777777-7777-4777-8777-777777777777";

describe("storage quota configuration", () => {
  it("is 10 GB per accepted member and 2 GB personal unless configured", () => {
    expect(storageQuotaConfiguration({})).toEqual({
      bytesPerMember: 10 * GIB,
      personalBytes: 2 * GIB,
      versionMarginPercent: 10,
    });
    expect(
      storageQuotaConfiguration({
        STORAGE_QUOTA_BYTES_PER_MEMBER: "5000",
        STORAGE_QUOTA_PERSONAL_BYTES: "700",
        STORAGE_QUOTA_VERSION_MARGIN_PERCENT: "25",
      }),
    ).toEqual({ bytesPerMember: 5000, personalBytes: 700, versionMarginPercent: 25 });
    expect(
      storageQuotaConfiguration({ STORAGE_QUOTA_VERSION_MARGIN_PERCENT: "0" }).versionMarginPercent,
    ).toBe(0);
    // A value that is not a positive number is ignored, never "no limit".
    expect(
      storageQuotaConfiguration({
        STORAGE_QUOTA_BYTES_PER_MEMBER: "0",
        STORAGE_QUOTA_PERSONAL_BYTES: "lots",
      }),
    ).toEqual({ bytesPerMember: 10 * GIB, personalBytes: 2 * GIB, versionMarginPercent: 10 });
  });

  it("reads only a whole number as a number: \"5000abc\" is not 5000", () => {
    for (const bad of ["5000abc", "12.5", "1e3", "-5", " ", "0x10"]) {
      expect(
        storageQuotaConfiguration({
          STORAGE_QUOTA_BYTES_PER_MEMBER: bad,
          STORAGE_QUOTA_PERSONAL_BYTES: bad,
          STORAGE_QUOTA_VERSION_MARGIN_PERCENT: bad,
        }),
      ).toEqual({ bytesPerMember: 10 * GIB, personalBytes: 2 * GIB, versionMarginPercent: 10 });
    }
    // The margin is a percentage: above 100 is not one.
    expect(
      storageQuotaConfiguration({ STORAGE_QUOTA_VERSION_MARGIN_PERCENT: "101" }).versionMarginPercent,
    ).toBe(10);
  });
});

describe("the space an upload session fills", () => {
  const tables = () => ({
    projects: [
      { id: PROJECT, org_id: FIRM, user_id: OWNER },
      { id: "personal-project", org_id: null, user_id: OWNER },
    ],
    workflows: [
      { id: WORKFLOW, org_id: FIRM, user_id: OWNER },
      { id: "personal-workflow", org_id: null, user_id: OWNER },
    ],
    documents: [
      { id: DOCUMENT, org_id: FIRM, user_id: OWNER },
      { id: "personal-document", org_id: null, user_id: OWNER },
    ],
  });
  const resolve = (purpose: string, destination: Record<string, unknown>) =>
    resolveUploadSpace(tableDb(tables()).db, {
      purpose,
      destination,
      userId: USER,
    });

  it("is the caller's personal space for a standalone or library upload with no organization", async () => {
    await expect(
      resolve("document_create", { scope: "standalone" }),
    ).resolves.toEqual({ ok: true, space: { orgId: null, userId: USER } });
    await expect(
      resolve("document_create", { scope: "library", library_kind: "file", org_id: null }),
    ).resolves.toEqual({ ok: true, space: { orgId: null, userId: USER } });
  });

  it("is the firm named by the workspace of a standalone or library upload", async () => {
    await expect(
      resolve("document_create", { scope: "standalone", org_id: FIRM }),
    ).resolves.toEqual({ ok: true, space: { orgId: FIRM, userId: null } });
  });

  it("follows the project's or the workflow's organization, and is personal when it has none", async () => {
    await expect(
      resolve("document_create", { scope: "project", project_id: PROJECT }),
    ).resolves.toEqual({ ok: true, space: { orgId: FIRM, userId: null } });
    await expect(
      resolve("document_create", { scope: "project", project_id: "personal-project" }),
    ).resolves.toEqual({ ok: true, space: { orgId: null, userId: USER } });
    await expect(
      resolve("document_create", { scope: "workflow", workflow_id: WORKFLOW }),
    ).resolves.toEqual({ ok: true, space: { orgId: FIRM, userId: null } });
    await expect(
      resolve("workflow_reference_create", { workflow_id: "personal-workflow" }),
    ).resolves.toEqual({ ok: true, space: { orgId: null, userId: USER } });
  });

  it("is the space of the document a new version is added to", async () => {
    await expect(
      resolve("document_version_create", { document_id: DOCUMENT }),
    ).resolves.toEqual({ ok: true, space: { orgId: FIRM, userId: null } });
    // A personal document is counted for the person who owns it.
    await expect(
      resolve("document_version_replace", { document_id: "personal-document", version_id: "v" }),
    ).resolves.toEqual({ ok: true, space: { orgId: null, userId: OWNER } });
  });

  it("charges a row carrying a personal organization to that person's personal space, not to a firm", async () => {
    const { db } = tableDb({
      ...tables(),
      organizations: [
        { id: FIRM, kind: "team", personal_user_id: null },
        { id: PERSONAL_ORG, kind: "personal", personal_user_id: OWNER },
      ],
      projects: [{ id: PROJECT, org_id: PERSONAL_ORG, user_id: OWNER }],
      documents: [{ id: DOCUMENT, org_id: PERSONAL_ORG, user_id: OWNER }],
    });
    const personalOf = { ok: true, space: { orgId: null, userId: OWNER } };
    await expect(
      resolveUploadSpace(db, { purpose: "document_create", destination: { scope: "project", project_id: PROJECT }, userId: USER }),
    ).resolves.toEqual(personalOf);
    await expect(
      resolveUploadSpace(db, { purpose: "document_version_create", destination: { document_id: DOCUMENT }, userId: USER }),
    ).resolves.toEqual(personalOf);
    // a team organization is still a firm
    await expect(
      resolveUploadSpace(db, { purpose: "document_create", destination: { scope: "standalone", org_id: FIRM }, userId: USER }),
    ).resolves.toEqual({ ok: true, space: { orgId: FIRM, userId: null } });
  });

  it("refuses to guess when the space cannot be read", async () => {
    const failing = tableDb(tables(), { failSelects: ["projects"] }).db;
    const result = await resolveUploadSpace(failing, {
      purpose: "document_create",
      destination: { scope: "project", project_id: PROJECT },
      userId: USER,
    });
    expect(result.ok).toBe(false);
  });
});

describe("one answer to how much a space uses", () => {
  it("returns used and limit bytes from the database function, with the configured limits", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ used_bytes: "1234", limit_bytes: "20000" }],
      error: null,
    }));
    const config = { bytesPerMember: 10_000, personalBytes: 500 };
    await expect(
      storageSpaceUsage({ rpc } as unknown as Db, { orgId: FIRM, userId: null }, config),
    ).resolves.toEqual({ usedBytes: 1234, limitBytes: 20000 });
    expect(rpc).toHaveBeenCalledWith("storage_space_usage", {
      p_org_id: FIRM,
      p_user_id: null,
      p_bytes_per_member: 10_000,
      p_personal_bytes: 500,
    });
    await storageSpaceUsage({ rpc } as unknown as Db, { orgId: null, userId: USER }, config);
    expect(rpc).toHaveBeenLastCalledWith("storage_space_usage", {
      p_org_id: null,
      p_user_id: USER,
      p_bytes_per_member: 10_000,
      p_personal_bytes: 500,
    });
  });

  it("throws when the answer cannot be read instead of reporting an empty space", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    await expect(
      storageSpaceUsage({ rpc } as unknown as Db, { orgId: null, userId: USER }),
    ).rejects.toThrow();
  });

  it("throws when a number of the answer is not a whole count of bytes, and reads zero as zero", async () => {
    const answer = (row: Record<string, unknown>) =>
      storageSpaceUsage(
        { rpc: vi.fn(async () => ({ data: [row], error: null })) } as unknown as Db,
        { orgId: null, userId: USER },
      );
    const unreadable: Record<string, unknown>[] = [
      {},
      { used_bytes: null, limit_bytes: null },
      { used_bytes: null, limit_bytes: "3000" },
      { used_bytes: "10", limit_bytes: null },
      { used_bytes: "abc", limit_bytes: "3000" },
      { used_bytes: "", limit_bytes: "3000" },
      { used_bytes: " 10", limit_bytes: "3000" },
      { used_bytes: "1e3", limit_bytes: "3000" },
      { used_bytes: "1.5", limit_bytes: "3000" },
      { used_bytes: 1.5, limit_bytes: 3000 },
      { used_bytes: "-1", limit_bytes: "3000" },
      { used_bytes: -1, limit_bytes: 3000 },
      { used_bytes: "10", limit_bytes: "-3000" },
      { used_bytes: "9007199254740993", limit_bytes: "3000" },
      { used_bytes: 2 ** 53, limit_bytes: 3000 },
      { used_bytes: Number.NaN, limit_bytes: 3000 },
      { used_bytes: Number.POSITIVE_INFINITY, limit_bytes: 3000 },
      { used_bytes: true, limit_bytes: 3000 },
    ];
    for (const row of unreadable) await expect(answer(row), JSON.stringify(row)).rejects.toThrow();
    await expect(answer({ used_bytes: 0, limit_bytes: "3000" })).resolves.toEqual({ usedBytes: 0, limitBytes: 3000 });
    await expect(answer({ used_bytes: "0", limit_bytes: 3000 })).resolves.toEqual({ usedBytes: 0, limitBytes: 3000 });
    await expect(answer({ used_bytes: "9007199254740991", limit_bytes: "9007199254740991" })).resolves.toEqual({
      usedBytes: Number.MAX_SAFE_INTEGER,
      limitBytes: Number.MAX_SAFE_INTEGER,
    });
  });

  it("gives the session-opening function the same space and limits", () => {
    expect(
      quotaRpcArgs({ orgId: FIRM, userId: null }, { bytesPerMember: 7, personalBytes: 3, versionMarginPercent: 10 }),
    ).toEqual({
      target_quota_org_id: FIRM,
      target_quota_user_id: null,
      target_quota_bytes_per_member: 7,
      target_quota_personal_bytes: 3,
      target_quota_version_margin_percent: 10,
    });
  });
});
