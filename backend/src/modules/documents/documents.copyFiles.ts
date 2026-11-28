import { createHash } from "node:crypto";
import {
  copyFile,
  createFileReadStream,
  downloadFile,
  downloadFileIfAvailable,
  headFile,
  uploadFile,
} from "../../lib/storage";
import { contentTypeForDocumentType } from "../../lib/documentTypes";
import {
  fitsInSpace,
  resolveUploadSpace,
  StorageQuotaExceededError,
  storageSpaceUsage,
} from "../../lib/storageQuota";
import { storageQuotaConfiguration } from "../../lib/runtimeConfig";
import type { Db } from "../../lib/supabase";

type CopySource = {
  storage_path: string;
  pdf_storage_path?: string | null;
  file_type?: string | null;
  size_bytes?: number | null;
  content_sha256?: string | null;
};

/**
 * Where the copy goes, as the upload door is told: the purpose and the
 * destination name the space it fills. A copy that creates a document asks
 * like `document_create`; a new version of an existing document like
 * `document_version_create` (which gets the version margin). The bytes asked
 * for are the stored size of the source; a request that copies several files
 * asks once for all of them with `askRoomForBatch`.
 */
export type CopyRoom = {
  db: Db;
  userId: string;
  purpose: "document_create" | "document_version_create";
  destination: Record<string, unknown>;
};

/**
 * Proof that the space was asked for a whole batch of copies. Only
 * `askRoomForBatch` makes one, so a batch caller cannot copy without having
 * asked.
 */
export class AskedRoom {
  private constructor() {}
  static ask(): AskedRoom {
    return new AskedRoom();
  }
}

/** The stored size of a source: the recorded one, else the object's own. */
export async function sourceStoredBytes(source: CopySource): Promise<number> {
  if (typeof source.size_bytes === "number") return source.size_bytes;
  const head = await headFile(source.storage_path);
  if (!head) throw new Error("copy_source_unavailable");
  return head.size;
}

/** The content hash of a source: the recorded one, else streamed (never buffered). */
export async function sourceContentSha256(source: CopySource): Promise<string> {
  if (source.content_sha256) return source.content_sha256;
  const hash = createHash("sha256");
  for await (const chunk of createFileReadStream(source.storage_path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Asked before anything is written, with the same figures and comparison as
 * the upload door. Refuses (StorageQuotaExceededError) when the bytes do not
 * fit; any unreadable figure throws, which also refuses. Not atomic against an
 * upload opened at the same moment: nothing is locked here.
 */
async function requireRoom(room: CopyRoom, bytes: number): Promise<void> {
  const space = await resolveUploadSpace(room.db, {
    purpose: room.purpose,
    destination: room.destination,
    userId: room.userId,
  });
  if (!space.ok) throw new Error(space.detail);
  const usage = await storageSpaceUsage(room.db, space.space);
  const margin =
    room.purpose === "document_version_create"
      ? storageQuotaConfiguration().versionMarginPercent
      : null;
  if (!fitsInSpace(usage, bytes, margin)) throw new StorageQuotaExceededError();
}

/**
 * Ask once for the space a batch of copies fills, before the first object is
 * written, with each source's stored size. A batch without sources asks
 * nothing. The returned proof is what the batch's copies pass as `room`.
 */
export async function askRoomForBatch(
  room: CopyRoom,
  sources: CopySource[],
): Promise<AskedRoom> {
  // A request that adds no stored bytes asks nothing and reads nothing.
  if (sources.length === 0) return AskedRoom.ask();
  let bytes = 0;
  for (const source of sources) bytes += await sourceStoredBytes(source);
  await requireRoom(room, bytes);
  return AskedRoom.ask();
}

/**
 * Copy an already-authorized version into fresh, caller-owned object keys.
 * Callers retain scope checks and metadata policy. Required renditions (batch
 * workflow assets) fail the copy; optional renditions (project/version copies)
 * preserve the source file when a legacy PDF object is missing.
 */
export async function copyDocumentVersionFiles(args: {
  source: CopySource;
  storagePath: string;
  pdfStoragePath: string;
  transport: "server" | "download";
  rendition: "required" | "optional";
  sourceBytes?: ArrayBuffer;
  /**
   * The space the copy fills, asked before any object is written; or the proof
   * that a whole batch was asked. `null` only for a move inside one space (the
   * source is deleted right after), which adds nothing to it.
   */
  room: CopyRoom | AskedRoom | null;
  beforeWrite?: (key: string) => void;
}): Promise<{ pdfStoragePath: string | null }> {
  if (args.room && !(args.room instanceof AskedRoom))
    await requireRoom(args.room, await sourceStoredBytes(args.source));
  const transfer = async (
    from: string,
    to: string,
    contentType: string,
    bytes?: ArrayBuffer,
  ) => {
    args.beforeWrite?.(to);
    if (args.transport === "server") return copyFile(from, to);
    const body = bytes ?? (await downloadFile(from));
    if (!body) throw new Error("copy_source_unavailable");
    await uploadFile(to, body, contentType);
  };
  await transfer(
    args.source.storage_path,
    args.storagePath,
    contentTypeForDocumentType(args.source.file_type ?? ""),
    args.sourceBytes,
  );
  const pdf = args.source.pdf_storage_path;
  if (!pdf) return { pdfStoragePath: null };
  if (pdf === args.source.storage_path)
    return { pdfStoragePath: args.storagePath };
  if (args.transport === "download" && args.rendition === "optional") {
    // The rendition is optional: a copy without it is still a copy, and the
    // source has already been written. A failed read is reported, not thrown.
    const bytes = await downloadFileIfAvailable(pdf);
    if (!bytes) return { pdfStoragePath: null };
    await transfer(pdf, args.pdfStoragePath, "application/pdf", bytes);
  } else {
    if (args.transport === "server" && args.rendition === "optional") {
      // Same tolerance as above: a legacy source whose rendition object is
      // missing (or cannot be looked up) is still copied, without it.
      const present = await headFile(pdf).catch(() => null);
      if (!present) return { pdfStoragePath: null };
    }
    await transfer(pdf, args.pdfStoragePath, "application/pdf");
  }
  return { pdfStoragePath: args.pdfStoragePath };
}
