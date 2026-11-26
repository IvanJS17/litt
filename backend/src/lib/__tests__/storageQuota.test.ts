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

describe("storage quota configuration", () => {
  it("is 10 GB per accepted member and 2 GB personal unless configured", () => {
    expect(storageQuotaConfiguration({})).toEqual({
      bytesPerMember: 10 * GIB,
      personalBytes: 2 * GIB,
    });
    expect(
      storageQuotaConfiguration({
        STORAGE_QUOTA_BYTES_PER_MEMBER: "5000",
        STORAGE_QUOTA_PERSONAL_BYTES: "700",
      }),
    ).toEqual({ bytesPerMember: 5000, personalBytes: 700 });
    // A value that is not a positive number is ignored, never "no limit".
    expect(
      storageQuotaConfiguration({
        STORAGE_QUOTA_BYTES_PER_MEMBER: "0",
        STORAGE_QUOTA_PERSONAL_BYTES: "lots",
      }),
    ).toEqual({ bytesPerMember: 10 * GIB, personalBytes: 2 * GIB });
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

  it("gives the session-opening function the same space and limits", () => {
    expect(
      quotaRpcArgs({ orgId: FIRM, userId: null }, { bytesPerMember: 7, personalBytes: 3 }),
    ).toEqual({
      target_quota_org_id: FIRM,
      target_quota_user_id: null,
      target_quota_bytes_per_member: 7,
      target_quota_personal_bytes: 3,
    });
  });
});
