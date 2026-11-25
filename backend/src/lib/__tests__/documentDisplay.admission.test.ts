import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ten displays at once with a converter that never finishes: the display reads
// nothing and starts nothing for a source over the bound, and for a source just
// under it the converter's own admission (two running, the rest wait or are
// refused) is what limits the work.
const converter = vi.hoisted(() => ({ started: 0, finishes: false }));
vi.mock("libreoffice-convert", () => ({
  default: {
    convertWithOptions: (
      _buf: Buffer,
      _ext: string,
      _filter: undefined,
      _options: unknown,
      callback: (error: Error | null, result: Buffer) => void,
    ) => {
      converter.started += 1;
      if (converter.finishes) callback(null, Buffer.from("%PDF-converted"));
    },
  },
}));

const storage = vi.hoisted(() => ({ size: 0, downloads: 0 }));
vi.mock("../storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../storage")>()),
  headFile: async () => ({ size: storage.size, etag: null, contentType: null }),
  downloadFile: async () => {
    storage.downloads += 1;
    return new ArrayBuffer(1);
  },
  downloadFileIfAvailable: async () => null,
}));

let loadDocumentDisplay: typeof import("../documentDisplay").loadDocumentDisplay;
let CONVERSION_MAX_SOURCE_BYTES: number;

beforeEach(async () => {
  converter.started = 0;
  converter.finishes = false;
  storage.downloads = 0;
  process.env.SOFFICE_BINARY_PATH = process.execPath;
  vi.resetModules();
  ({ loadDocumentDisplay } = await import("../documentDisplay.js"));
  ({ CONVERSION_MAX_SOURCE_BYTES } = await import("../conversionLimits.js"));
});

afterEach(() => {
  delete process.env.SOFFICE_BINARY_PATH;
});

const word = { filename: "Big.docx", fileType: "docx", storagePath: "big.docx" };
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("concurrent displays of a Word file with no stored rendition", () => {
  it("reads nothing and starts no conversion when the source is over the bound", async () => {
    storage.size = CONVERSION_MAX_SOURCE_BYTES + 1;
    const calls = Array.from({ length: 10 }, () => loadDocumentDisplay(word).then(() => "done", (e: unknown) => e));
    const outcomes = await Promise.all(calls);
    expect(outcomes.every((o) => o instanceof Error)).toBe(true);
    expect(storage.downloads).toBe(0);
    expect(converter.started).toBe(0);
  });

  it("starts at most two conversions when the source is just under the bound", async () => {
    storage.size = CONVERSION_MAX_SOURCE_BYTES;
    const controller = new AbortController();
    const calls = Array.from({ length: 10 }, () =>
      loadDocumentDisplay({ ...word, signal: controller.signal }).then(() => "done", () => "stopped"),
    );
    await tick();
    expect(storage.downloads).toBe(10);
    expect(converter.started).toBe(2);
    controller.abort();
    await Promise.all(calls.slice(2));
  });

  it("holds at most as many sources as the converter has places: the rest are told to retry and read nothing", async () => {
    storage.size = CONVERSION_MAX_SOURCE_BYTES;
    const controller = new AbortController();
    const calls = Array.from({ length: 30 }, () =>
      loadDocumentDisplay({ ...word, signal: controller.signal }).then(() => "done", (e: unknown) => (e as Error).name),
    );
    await tick();
    expect(storage.downloads).toBe(10);
    expect(converter.started).toBe(2);
    const refused = await Promise.all(calls.slice(10));
    expect(refused).toEqual(Array.from({ length: 20 }, () => "ExtractionBusyError"));

    // The places come back when the displays end.
    controller.abort();
    await Promise.all(calls.slice(2, 10));
    void loadDocumentDisplay(word).catch(() => undefined);
    await tick();
    expect(storage.downloads).toBe(11);
  });

  it("keeps the place of a converted display until its response ends", async () => {
    storage.size = CONVERSION_MAX_SOURCE_BYTES;
    converter.finishes = true;
    // Ten displays are converted and wait for clients that have not read them yet.
    const responses = Array.from({ length: 10 }, () => new AbortController());
    const converted = await Promise.all(
      responses.map((response) => loadDocumentDisplay({ ...word, signal: response.signal })),
    );
    expect(converted.every((payload) => payload?.contentType === "application/pdf")).toBe(true);
    expect(storage.downloads).toBe(10);

    await expect(loadDocumentDisplay({ ...word, signal: new AbortController().signal })).rejects.toMatchObject({
      name: "ExtractionBusyError",
    });
    expect(storage.downloads).toBe(10);

    // One response ends: one place comes back.
    responses[0].abort();
    const next = new AbortController();
    expect((await loadDocumentDisplay({ ...word, signal: next.signal }))?.contentType).toBe("application/pdf");
    expect(storage.downloads).toBe(11);
    await expect(loadDocumentDisplay({ ...word, signal: new AbortController().signal })).rejects.toMatchObject({
      name: "ExtractionBusyError",
    });
  });

  it("gives the place back at once when there is no response to wait for, or it has already ended", async () => {
    storage.size = CONVERSION_MAX_SOURCE_BYTES;
    converter.finishes = true;
    const gone = new AbortController();
    gone.abort();
    for (let display = 0; display < 12; display++) {
      await loadDocumentDisplay(word).catch(() => undefined);
      await loadDocumentDisplay({ ...word, signal: gone.signal }).catch(() => undefined);
    }
    expect((await loadDocumentDisplay(word))?.contentType).toBe("application/pdf");
  });
});
