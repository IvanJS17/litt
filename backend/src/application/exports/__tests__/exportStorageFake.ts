/**
 * An in-memory object store for the queued export tests: objects are read
 * lazily as streams, and the finished archive is handed over as a file path,
 * as the real storage does. Nothing here touches a network.
 */
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { vi } from "vitest";

/** A stored object that is produced chunk by chunk, so a test can be large without allocating it. */
export type StreamedSource = { headSize: number | null; chunks: () => AsyncIterable<Uint8Array> };
type Stored = Uint8Array | StreamedSource | null;

export function createExportStorageFake(read: (key: string) => Stored | Promise<Stored>) {
  const uploads: Array<{ key: string; bytes: Buffer; contentType: string; path: string }> = [];
  const opened: string[] = [];
  const state = { open: 0, peakOpen: 0 };
  const sizeOf = (stored: Uint8Array | StreamedSource) =>
    stored instanceof Uint8Array ? stored.byteLength : stored.headSize;
  const headFile = vi.fn(async (key: string) => {
    const stored = await read(key);
    return stored ? { size: sizeOf(stored) ?? 0, etag: null, contentType: null } : null;
  });
  const createFileReadStream = vi.fn((key: string) =>
    Readable.from(
      (async function* () {
        opened.push(key);
        state.open += 1;
        state.peakOpen = Math.max(state.peakOpen, state.open);
        try {
          const stored = await read(key);
          if (!stored) throw new Error(`missing object ${key}`);
          if (stored instanceof Uint8Array) yield stored;
          else yield* stored.chunks();
        } finally {
          state.open -= 1;
        }
      })(),
    ),
  );
  const uploadFileFromPath = vi.fn(async (key: string, path: string, contentType: string) => {
    const bytes = await readFile(path);
    expectSize(bytes.byteLength, (await stat(path)).size);
    uploads.push({ key, bytes, contentType, path });
  });
  /** The whole-buffer upload the queued export must no longer use. */
  const uploadFile = vi.fn(async () => {});
  return {
    uploads,
    opened,
    state,
    headFile,
    createFileReadStream,
    uploadFileFromPath,
    uploadFile,
    /** The object-store adapter form, for tests that install an adapter. */
    adapter: () =>
      ({
        enabled: true,
        configurationHint: "test",
        headFile,
        openReadStream: async (key: string) => createFileReadStream(key),
        uploadFileFromPath,
        uploadFile,
      }) as never,
    /** The storage-facade form, for tests that replace the module. */
    facade: () => ({ headFile, createFileReadStream, openFileStream: async (key: string) => createFileReadStream(key), uploadFileFromPath, uploadFile }),
  };
}

function expectSize(read: number, onDisk: number) {
  if (read !== onDisk) throw new Error("archive file changed while it was uploaded");
}
