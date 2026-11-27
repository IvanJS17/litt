import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The storage quota is checked in one place: opening an upload session. A
// session that creates documents is checked against the limit; one that adds a
// new version to an existing document (the web editor's save of a Word
// document, an uploaded new version, a replaced version, the add-in's version
// upload) is checked against the limit plus the margin, so saving an edit keeps
// working when the space is full (uploadSessions.routes.test.ts and
// uploads.storageQuota.sql exercise both). The Markdown save and documents the
// assistant generates are direct writes that are not checked in this part (part
// 2 gives them the same margin); downloads and deletions never ask. Only the
// upload session opening refuses by the quota. Two reads, a person's own
// personal space and a firm's space (owners and administrators), only report
// the usage and refuse nothing. This pins which files may know about the quota.
const SRC = path.resolve(__dirname, "../../..");

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory())
      return name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

const relative = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

describe("who asks the storage quota", () => {
  const files = sources(SRC);

  it("is the upload session opening and the two usage reads, nothing that writes versions directly, downloads or deletes", () => {
    const askers = files
      .filter((file) =>
        /storageQuota(?!Fill)|storage_space_usage|target_quota_/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map(relative)
      .sort();
    expect(askers).toEqual([
      "lib/runtimeConfig.ts",
      "lib/storageQuota.ts",
      "modules/orgs/orgs.storageUsage.ts",
      "modules/uploads/uploads.open.ts",
      "modules/uploads/uploads.sessions.ts",
      "modules/user/user.storageUsage.ts",
    ]);
  });

  it("opens sessions through one function only", () => {
    const callers = files
      .filter((file) => readFileSync(file, "utf8").includes('"create_upload_session"'))
      .map(relative);
    expect(callers).toEqual(["modules/uploads/uploads.sessions.ts"]);
  });
});
