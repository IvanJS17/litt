import type { Response } from "express";
import { Readable } from "node:stream";
import { docxToPdf } from "./convert";
import { CONVERSION_MAX_SOURCE_BYTES, CONVERSION_PLACES, CONVERSION_SOURCE_TOO_LARGE_CODE } from "./conversionLimits";
import { ExtractionBusyError } from "./extraction/limits";
import {
  contentTypeForDocumentType,
  shouldConvertToPdf,
} from "./documentTypes";
import { pipeToResponse } from "./pipeToResponse";
import { envInt } from "./runtimeConfig";
import {
  buildContentDisposition,
  createFileReadStream,
  downloadFile,
  downloadFileIfAvailable,
  headFile,
} from "./storage";

export interface DocumentDisplaySource {
  filename: string;
  fileType?: string | null;
  storagePath: string;
  pdfStoragePath?: string | null;
  /**
   * Aborts when the request's response closes, finished or not. A conversion
   * still queued for a place leaves the queue then, and a converted display
   * keeps its place until then.
   */
  signal?: AbortSignal;
}

export interface DocumentDisplayPayload {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

function normalizedFileType(source: {
  filename: string;
  fileType?: string | null;
}): string {
  return (
    source.fileType?.trim().toLowerCase() ||
    source.filename.split(".").pop()?.toLowerCase() ||
    ""
  );
}

function toBuffer(bytes: ArrayBuffer | ArrayBufferView): Buffer {
  return ArrayBuffer.isView(bytes)
    ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : Buffer.from(bytes);
}

/** Display conversions of this thread that hold a source or a converted file right now. */
let displaySourcesHeld = 0;

/** A Word or presentation source above the conversion bound: it is not read or converted. */
export class DisplaySourceTooLargeError extends Error {
  constructor() {
    super("The document is too large to preview.");
    this.name = "DisplaySourceTooLargeError";
  }
}

export async function prepareDocumentDisplay(source: {
  filename: string;
  fileType?: string | null;
  sourceBytes: ArrayBuffer | ArrayBufferView;
  signal?: AbortSignal;
}): Promise<DocumentDisplayPayload> {
  const fileType = normalizedFileType(source);
  if (shouldConvertToPdf(fileType)) {
    if (source.sourceBytes.byteLength > CONVERSION_MAX_SOURCE_BYTES) throw new DisplaySourceTooLargeError();
    return {
      bytes: await docxToPdf(toBuffer(source.sourceBytes), { signal: source.signal }),
      contentType: "application/pdf",
      filename: pdfFilename(source.filename),
    };
  }
  return {
    bytes: toBuffer(source.sourceBytes),
    contentType: contentTypeForDocumentType(fileType),
    filename: source.filename,
  };
}

function pdfFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  return `${stem || filename}.pdf`;
}

/**
 * Resolve the bytes and response metadata used by every document-like preview.
 * Word and presentation files always become PDF, using a stored rendition when
 * available and LibreOffice as the fallback. PDFs and spreadsheets are served
 * unchanged.
 */
export async function loadDocumentDisplay(
  source: DocumentDisplaySource,
): Promise<DocumentDisplayPayload | null> {
  const fileType = normalizedFileType(source);
  const convertToPdf = shouldConvertToPdf(fileType);

  if (convertToPdf) {
    if (source.pdfStoragePath) {
      const pdfBytes = await downloadFileIfAvailable(source.pdfStoragePath);
      if (pdfBytes) {
        return {
          bytes: Buffer.from(pdfBytes),
          contentType: "application/pdf",
          filename: pdfFilename(source.filename),
        };
      }
    }
    // The size is learned without reading the object: a source above the
    // bound is never downloaded. headFile gives null for an object that is not there.
    const metadata = await headFile(source.storagePath);
    if (!metadata) return null;
    if (metadata.size > CONVERSION_MAX_SOURCE_BYTES) throw new DisplaySourceTooLargeError();
    // A display holds its source from the download, and then the converted
    // file until its response ends, so no more displays hold one than the
    // converter has places: the rest are told to retry, as a full converter
    // tells them.
    if (displaySourcesHeld >= CONVERSION_PLACES) throw new ExtractionBusyError();
    displaySourcesHeld += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      displaySourcesHeld -= 1;
    };
    let converted: DocumentDisplayPayload | null = null;
    try {
      const sourceBytes = await downloadFile(source.storagePath);
      if (!sourceBytes) return null;
      converted = await prepareDocumentDisplay({
        filename: source.filename,
        fileType,
        sourceBytes,
        signal: source.signal,
      });
      return converted;
    } finally {
      // With a converted file and a response still open, the place goes back
      // when that response closes; otherwise now.
      if (converted && source.signal && !source.signal.aborted)
        source.signal.addEventListener("abort", release, { once: true });
      else release();
    }
  }

  const storedBytes = await downloadFile(source.storagePath);
  if (!storedBytes) return null;
  return prepareDocumentDisplay({
    filename: source.filename,
    fileType,
    sourceBytes: storedBytes,
  });
}

export function sendDocumentDisplay(
  res: Response,
  payload: DocumentDisplayPayload,
): void {
  res.setHeader("Content-Type", payload.contentType);
  res.setHeader(
    "Content-Disposition",
    buildContentDisposition("inline", payload.filename),
  );
  // The file is held in memory until the client has it. A client that makes
  // no progress for this long does not keep it, or a display's place.
  res.setTimeout(envInt("DISPLAY_SEND_IDLE_MS", 60_000), () => res.destroy());
  res.send(payload.bytes);
}

/** A stored object served as it is, read from the store as the client takes it. */
export interface DocumentDisplayStream {
  stream: Readable;
  size: number;
  /** The store's own validator for the object, when it gives one. */
  etag: string | null;
  contentType: string;
  filename: string;
}

/**
 * The stored object a display serves unchanged (a PDF rendition, or a file
 * type that is not converted) as a stream with its size, or null when the
 * display has to be built from bytes instead (a Word or presentation file with
 * no stored rendition, or an object that is not there).
 */
export async function streamStoredDisplay(
  source: DocumentDisplaySource,
): Promise<DocumentDisplayStream | null> {
  const fileType = normalizedFileType(source);
  const convertToPdf = shouldConvertToPdf(fileType);
  const key = convertToPdf ? source.pdfStoragePath : source.storagePath;
  const metadata = key ? await headFile(key) : null;
  if (!key || !metadata) return null;
  return {
    stream: createFileReadStream(key),
    size: metadata.size,
    etag: metadata.etag,
    contentType: convertToPdf ? "application/pdf" : contentTypeForDocumentType(fileType),
    filename: convertToPdf ? pdfFilename(source.filename) : source.filename,
  };
}

/** The object, and exactly `size` bytes of it: any other length fails the read. */
async function* exactly(source: Readable, size: number) {
  let seen = 0;
  for await (const chunk of source) {
    seen += chunk.length;
    if (seen > size) throw new Error("The stored object grew while it was being sent.");
    yield chunk;
  }
  if (seen !== size) throw new Error("The stored object shrank while it was being sent.");
}

/**
 * Send a stored object. Its validator is sent and a matching conditional
 * request is answered 304 without reading it; a HEAD request reads nothing.
 * Without a validator from the store, a conditional request gets the full body.
 * The sent length is the measured one: an object that changed since is cut
 * off, so the client sees a failed download and not a corrupted one.
 */
export async function sendDocumentDisplayStream(
  res: Response,
  payload: DocumentDisplayStream,
): Promise<void> {
  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("Content-Disposition", buildContentDisposition("inline", payload.filename));
  if (payload.etag) res.setHeader("ETag", payload.etag);
  if (payload.etag && res.req.fresh) {
    payload.stream.destroy();
    res.status(304).end();
    return;
  }
  if (res.req.method === "HEAD") {
    payload.stream.destroy();
    res.setHeader("Content-Length", payload.size);
    res.end();
    return;
  }
  res.setHeader("Content-Length", payload.size);
  try {
    await pipeToResponse(Readable.from(exactly(payload.stream, payload.size)), res);
  } catch (error) {
    payload.stream.destroy();
    // Once bytes are on the wire the response is already destroyed; before
    // that the caller still answers with an error status.
    if (!res.headersSent && !res.destroyed) {
      res.removeHeader("Content-Length");
      throw error;
    }
  }
}

/** The converter has no place for this request: try again shortly. */
export function sendDisplayBusy(res: Response): void {
  res.setHeader("Retry-After", "30");
  res.status(503).json({ detail: "Document conversion is busy. Try again shortly." });
}

/** The source is above the conversion bound: the answer the convert surface gives. */
export function sendDisplayTooLarge(res: Response): void {
  res.status(400).json({
    code: CONVERSION_SOURCE_TOO_LARGE_CODE,
    detail: "The document is too large to preview.",
  });
}
