import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  docxToPdf: vi.fn(),
  headFile: vi.fn(),
  createFileReadStream: vi.fn(),
}));

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  // The rendition is an optional read; both entry points share one fake so
  // the call order the tests assert covers both.
  return {
    ...actual,
    downloadFile: mocks.downloadFile,
    downloadFileIfAvailable: mocks.downloadFile,
    headFile: mocks.headFile,
    createFileReadStream: mocks.createFileReadStream,
  };
});

vi.mock("../convert", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../convert")>();
  return { ...actual, docxToPdf: mocks.docxToPdf };
});

import { Readable } from "node:stream";
import { CONVERSION_MAX_SOURCE_BYTES } from "../convert";
import {
  DisplaySourceTooLargeError,
  loadDocumentDisplay,
  prepareDocumentDisplay,
  streamStoredDisplay,
} from "../documentDisplay";

describe("loadDocumentDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadFile.mockResolvedValue(Buffer.from("source"));
    mocks.docxToPdf.mockResolvedValue(Buffer.from("converted"));
    mocks.headFile.mockResolvedValue({ size: 6, etag: null, contentType: null });
  });

  it.each(["doc", "docx", "ppt", "pptx"])(
    "converts an unrendered %s file to PDF",
    async (fileType) => {
      const result = await loadDocumentDisplay({
        filename: `Asset.${fileType}`,
        fileType,
        storagePath: `asset.${fileType}`,
      });

      expect(mocks.downloadFile).toHaveBeenCalledWith(`asset.${fileType}`);
      expect(mocks.docxToPdf).toHaveBeenCalledOnce();
      expect(result).toEqual({
        bytes: Buffer.from("converted"),
        contentType: "application/pdf",
        filename: "Asset.pdf",
      });
    },
  );

  it("uses a persisted PDF rendition without converting again", async () => {
    const result = await loadDocumentDisplay({
      filename: "Asset.pptx",
      fileType: "pptx",
      storagePath: "asset.pptx",
      pdfStoragePath: "asset.pdf",
    });

    expect(mocks.downloadFile).toHaveBeenCalledWith("asset.pdf");
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(result?.contentType).toBe("application/pdf");
  });

  it("falls back to converting the source when a persisted rendition is missing", async () => {
    mocks.downloadFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(Buffer.from("source"));

    const result = await loadDocumentDisplay({
      filename: "Asset.doc",
      fileType: "doc",
      storagePath: "asset.doc",
      pdfStoragePath: "missing.pdf",
    });

    expect(mocks.downloadFile).toHaveBeenNthCalledWith(1, "missing.pdf");
    expect(mocks.downloadFile).toHaveBeenNthCalledWith(2, "asset.doc");
    expect(mocks.docxToPdf).toHaveBeenCalledOnce();
    expect(result?.bytes).toEqual(Buffer.from("converted"));
  });

  it("serves spreadsheets unchanged", async () => {
    const result = await loadDocumentDisplay({
      filename: "Asset.xlsx",
      fileType: "xlsx",
      storagePath: "asset.xlsx",
    });

    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      bytes: Buffer.from("source"),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "Asset.xlsx",
    });
  });
  it("hands the request's abort to the conversion", async () => {
    const signal = new AbortController().signal;
    await loadDocumentDisplay({ filename: "Asset.docx", fileType: "docx", storagePath: "asset.docx", signal });
    expect(mocks.docxToPdf).toHaveBeenCalledWith(expect.anything(), { signal });
  });
});

describe("display source bound", () => {
  const word = { filename: "Big.docx", fileType: "docx", storagePath: "big.docx" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadFile.mockResolvedValue(Buffer.from("source"));
    mocks.docxToPdf.mockResolvedValue(Buffer.from("converted"));
  });

  it("refuses a source over the bound without downloading it or asking for a conversion place", async () => {
    mocks.headFile.mockResolvedValue({ size: CONVERSION_MAX_SOURCE_BYTES + 1, etag: null, contentType: null });
    await expect(loadDocumentDisplay(word)).rejects.toBeInstanceOf(DisplaySourceTooLargeError);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
  });

  it("converts a source exactly at the bound", async () => {
    mocks.headFile.mockResolvedValue({ size: CONVERSION_MAX_SOURCE_BYTES, etag: null, contentType: null });
    const result = await loadDocumentDisplay(word);
    expect(mocks.docxToPdf).toHaveBeenCalledOnce();
    expect(result?.contentType).toBe("application/pdf");
  });

  it("answers not found, without downloading, when the stored object is not there", async () => {
    mocks.headFile.mockResolvedValue(null);
    expect(await loadDocumentDisplay(word)).toBeNull();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("still serves a stored rendition of an over-bound source", async () => {
    mocks.headFile.mockResolvedValue({ size: CONVERSION_MAX_SOURCE_BYTES + 1, etag: null, contentType: null });
    const result = await loadDocumentDisplay({ ...word, pdfStoragePath: "big.pdf" });
    expect(mocks.downloadFile).toHaveBeenCalledWith("big.pdf");
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
    expect(result?.contentType).toBe("application/pdf");
  });

  it("refuses over-bound bytes handed to prepareDocumentDisplay before asking for a conversion place", async () => {
    await expect(
      prepareDocumentDisplay({ ...word, sourceBytes: Buffer.alloc(CONVERSION_MAX_SOURCE_BYTES + 1) }),
    ).rejects.toBeInstanceOf(DisplaySourceTooLargeError);
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
  });

  it("starts no conversion and reads nothing for 10 concurrent displays of an over-bound source", async () => {
    mocks.headFile.mockResolvedValue({ size: CONVERSION_MAX_SOURCE_BYTES + 1, etag: null, contentType: null });
    mocks.docxToPdf.mockImplementation(() => new Promise(() => {}));
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, () => loadDocumentDisplay(word)));
    expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.docxToPdf).not.toHaveBeenCalled();
  });
});

describe("streamStoredDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headFile.mockResolvedValue({ size: 1234, etag: '"e1"', contentType: null });
    mocks.createFileReadStream.mockImplementation(() => Readable.from(["stored"]));
  });

  it("serves a stored rendition from the object store, with its size and validator, without reading it into memory", async () => {
    const result = await streamStoredDisplay({
      filename: "Asset.docx", fileType: "docx", storagePath: "asset.docx", pdfStoragePath: "asset.pdf",
    });

    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.createFileReadStream).toHaveBeenCalledWith("asset.pdf");
    expect(result).toMatchObject({ size: 1234, etag: '"e1"', contentType: "application/pdf", filename: "Asset.pdf" });
  });

  it("serves a spreadsheet from the object store", async () => {
    const result = await streamStoredDisplay({ filename: "Asset.xlsx", fileType: "xlsx", storagePath: "asset.xlsx" });
    expect(mocks.createFileReadStream).toHaveBeenCalledWith("asset.xlsx");
    expect(result).toMatchObject({ size: 1234, filename: "Asset.xlsx" });
  });

  it("leaves a Word file with no stored rendition, and an object that is gone, to the bytes path", async () => {
    expect(await streamStoredDisplay({ filename: "Asset.docx", fileType: "docx", storagePath: "asset.docx" })).toBeNull();
    mocks.headFile.mockResolvedValue(null);
    expect(await streamStoredDisplay({ filename: "Asset.xlsx", fileType: "xlsx", storagePath: "gone.xlsx" })).toBeNull();
  });
});
