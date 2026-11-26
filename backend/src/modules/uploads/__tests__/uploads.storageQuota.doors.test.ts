import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The storage quota refuses only a NEW upload: opening an upload session. A
// version saved by editing, a document the assistant generates, a download and
// a deletion never ask the quota, so they keep working when a space is full.
// This pins which files may know about it.
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

  it("is the upload session opening, nothing that edits, generates, downloads or deletes", () => {
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
      "modules/uploads/uploads.open.ts",
      "modules/uploads/uploads.sessions.ts",
    ]);
  });

  it("opens sessions through one function only", () => {
    const callers = files
      .filter((file) => readFileSync(file, "utf8").includes('"create_upload_session"'))
      .map(relative);
    expect(callers).toEqual(["modules/uploads/uploads.sessions.ts"]);
  });
});
