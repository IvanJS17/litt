import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  copyFile: vi.fn(),
  downloadFile: vi.fn(),
  downloadFileIfAvailable: vi.fn(),
  uploadFile: vi.fn(),
}));
vi.mock("../../../lib/storage", () => storage);
const quota = vi.hoisted(() => ({ space: vi.fn(), usage: vi.fn() }));
vi.mock("../../../lib/storageQuota", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storageQuota")>()),
  resolveUploadSpace: quota.space,
  storageSpaceUsage: quota.usage,
}));
import { askRoomForBatch, copyDocumentVersionFiles } from "../documents.copyFiles";
beforeEach(() => {
  vi.clearAllMocks();
  storage.copyFile.mockResolvedValue(undefined);
  storage.downloadFile.mockResolvedValue(null);
  storage.downloadFileIfAvailable.mockResolvedValue(null);
  quota.space.mockResolvedValue({ ok: true, space: { orgId: null, userId: "u1" } });
  quota.usage.mockResolvedValue({ usedBytes: 1500, limitBytes: 1000 });
});
const base = {
  source: {
    storage_path: "source",
    file_type: "pdf",
    pdf_storage_path: "source",
  },
  storagePath: "copy",
  pdfStoragePath: "copy-pdf",
  transport: "server" as const,
  rendition: "required" as const,
  room: null,
};

describe("copying version objects", () => {
  it("copies a PDF's shared source/rendition only once", async () => {
    expect(await copyDocumentVersionFiles(base)).toEqual({
      pdfStoragePath: "copy",
    });
    expect(storage.copyFile).toHaveBeenCalledExactlyOnceWith("source", "copy");
  });
  it("tracks each prospective object before writing it for caller rollback", async () => {
    const writes: string[] = [];
    storage.copyFile.mockImplementation(async (_from, to) => {
      expect(writes).toContain(to);
    });
    await copyDocumentVersionFiles({
      ...base,
      source: { ...base.source, pdf_storage_path: "pdf" },
      beforeWrite: (key) => {
        writes.push(key);
      },
    });
    expect(writes).toEqual(["copy", "copy-pdf"]);
  });
  it("allows a missing optional rendition but retains the source", async () => {
    const bytes = new Uint8Array([1, 2]).buffer;
    expect(
      await copyDocumentVersionFiles({
        ...base,
        source: { ...base.source, pdf_storage_path: "missing" },
        transport: "download",
        rendition: "optional",
        sourceBytes: bytes,
      }),
    ).toEqual({ pdfStoragePath: null });
    expect(storage.uploadFile).toHaveBeenCalledWith(
      "copy",
      bytes,
      "application/pdf",
    );
  });
  it("fails a required rendition copy instead of reporting a complete asset", async () => {
    storage.copyFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("PDF unavailable"));
    await expect(
      copyDocumentVersionFiles({
        ...base,
        source: { ...base.source, pdf_storage_path: "missing" },
      }),
    ).rejects.toThrow("PDF unavailable");
  });

  // The rendition is read through the helper that answers null for a failed
  // read as well as a missing object (reporting it once), so a storage fault
  // on the optional PDF never aborts a copy whose source is already written.
  it("reads the optional rendition through the failure-absorbing helper", async () => {
    const bytes = new Uint8Array([1, 2]).buffer;
    storage.downloadFileIfAvailable.mockResolvedValue(null);
    const result = await copyDocumentVersionFiles({
      ...base,
      source: { ...base.source, pdf_storage_path: "src/rendition.pdf" },
      transport: "download",
      rendition: "optional",
      sourceBytes: bytes,
    });
    expect(result).toEqual({ pdfStoragePath: null });
    expect(storage.downloadFileIfAvailable).toHaveBeenCalledWith("src/rendition.pdf");
    expect(storage.downloadFile).not.toHaveBeenCalled();
    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
  });
});

describe("asking the space for a batch", () => {
  const room = { db: {} as never, userId: "u1", purpose: "document_create" as const, destination: { scope: "library" } };

  it("asks nothing and reads nothing for a batch without sources", async () => {
    quota.usage.mockRejectedValue(new Error("unreadable"));
    quota.space.mockResolvedValue({ ok: false, detail: "unreadable" });
    await expect(askRoomForBatch(room, [])).resolves.toBeDefined();
    expect(quota.space).not.toHaveBeenCalled();
    expect(quota.usage).not.toHaveBeenCalled();
  });

  it("asks for a batch whose sources add up to zero bytes", async () => {
    await expect(
      askRoomForBatch(room, [{ storage_path: "empty", size_bytes: 0 }]),
    ).rejects.toThrow();
    expect(quota.usage).toHaveBeenCalledTimes(1);
  });
});
