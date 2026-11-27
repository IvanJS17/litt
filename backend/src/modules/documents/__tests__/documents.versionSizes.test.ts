import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tableDb } from "../../../__tests__/helpers/tableDb";
import {
  setStorageAdapter,
  type StorageAdapter,
  type StoredObjectMetadata,
} from "../../../lib/storage";
import { fillMissingVersionSizes } from "../documents.versionSizes";

// The storage fake: objects by key. A key that is not in `objects` does not
// exist; a key in `broken` fails the way a storage outage does.
function fakeStorage(
  objects: Record<string, number>,
  broken: string[] = [],
): StorageAdapter {
  return {
    enabled: true,
    configurationHint: "",
    headFile: vi.fn(async (key: string): Promise<StoredObjectMetadata | null> => {
      if (broken.includes(key)) throw new Error("storage unavailable");
      return key in objects
        ? { size: objects[key], etag: null, contentType: null }
        : null;
    }),
  } as unknown as StorageAdapter;
}

const versions = () => [
  { id: "v1", storage_path: "docs/a.docx", size_bytes: null },
  { id: "v2", storage_path: "docs/gone.docx", size_bytes: null },
  { id: "v3", storage_path: "docs/c.docx", size_bytes: 55 },
  { id: "v4", storage_path: null, size_bytes: null },
  { id: "v5", storage_path: "docs/e.docx", size_bytes: null },
  { id: "v6", storage_path: "docs/broken.docx", size_bytes: null },
  { id: "v7", storage_path: "docs/empty.docx", size_bytes: null },
];
const objects = { "docs/a.docx": 1234, "docs/c.docx": 999, "docs/e.docx": 4321, "docs/empty.docx": 0 };

describe("fillMissingVersionSizes", () => {
  let log: ReturnType<typeof vi.fn<(line: string) => void>>;
  beforeEach(() => {
    log = vi.fn<(line: string) => void>();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("changes nothing by default and says what it would do", async () => {
    setStorageAdapter(fakeStorage(objects, ["docs/broken.docx"]));
    const { db, tables, calls } = tableDb({ document_versions: versions() });

    const counts = await fillMissingVersionSizes(db, { write: false, batchSize: 2, log });

    expect(counts).toEqual({ found: 5, wouldFill: 3, filled: 0, missing: 1, failed: 1 });
    expect(calls.filter((call) => call.op === "update")).toEqual([]);
    expect(tables.document_versions.map((row) => row.size_bytes)).toEqual([
      null, null, 55, null, null, null, null,
    ]);
  });

  it("writes the size of every readable object, and only that, when asked to", async () => {
    setStorageAdapter(fakeStorage(objects, ["docs/broken.docx"]));
    const { db, tables } = tableDb({ document_versions: versions() });

    const counts = await fillMissingVersionSizes(db, { write: true, batchSize: 2, log });

    expect(counts).toEqual({ found: 5, wouldFill: 3, filled: 3, missing: 1, failed: 1 });
    expect(tables.document_versions).toEqual([
      { id: "v1", storage_path: "docs/a.docx", size_bytes: 1234 },
      { id: "v2", storage_path: "docs/gone.docx", size_bytes: null },
      // A size already recorded is never overwritten, even if the object differs.
      { id: "v3", storage_path: "docs/c.docx", size_bytes: 55 },
      { id: "v4", storage_path: null, size_bytes: null },
      { id: "v5", storage_path: "docs/e.docx", size_bytes: 4321 },
      { id: "v6", storage_path: "docs/broken.docx", size_bytes: null },
      { id: "v7", storage_path: "docs/empty.docx", size_bytes: 0 },
    ]);
  });

  it("can be run twice: the second run finds only what is still missing", async () => {
    setStorageAdapter(fakeStorage(objects, ["docs/broken.docx"]));
    const { db } = tableDb({ document_versions: versions() });
    await fillMissingVersionSizes(db, { write: true, log });

    const again = await fillMissingVersionSizes(db, { write: true, log });

    expect(again).toEqual({ found: 2, wouldFill: 0, filled: 0, missing: 1, failed: 1 });
  });

  it("never reaches for the objects of versions that already have a size", async () => {
    const storage = fakeStorage(objects);
    setStorageAdapter(storage);
    const { db } = tableDb({
      document_versions: [{ id: "v3", storage_path: "docs/c.docx", size_bytes: 55 }],
    });

    await expect(fillMissingVersionSizes(db, { write: true, log })).resolves.toMatchObject({ found: 0 });
    expect(storage.headFile).not.toHaveBeenCalled();
  });

  it("prints the counts", async () => {
    setStorageAdapter(fakeStorage(objects));
    const { db } = tableDb({ document_versions: versions() });
    await fillMissingVersionSizes(db, { write: false, log });
    const printed = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).toMatch(/dry run/i);
    expect(printed).toMatch(/found 5/);
  });
});
